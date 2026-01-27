//! Application state and logic

use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use tokio::sync::mpsc;

use crate::client::{ServerEvent, VersClient};
use crate::ui::CanvasState;
use crate::vm::TreeState;

/// View mode - which screen is active
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum ViewMode {
    #[default]
    Chat,
    Canvas,
}

/// Input mode
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum InputMode {
    #[expect(dead_code, reason = "Vi-style normal mode, will be implemented")]
    Normal,
    Insert,
}

/// Application status
#[derive(Debug, Clone, PartialEq)]
pub enum AppStatus {
    Connecting,
    Connected,
    Processing,
    Error(String),
}

/// A message in the conversation
#[derive(Debug, Clone)]
pub struct Message {
    pub role: MessageRole,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MessageRole {
    User,
    Assistant,
    System,
}

/// Main application state
pub struct App {
    /// Server URL
    pub server_url: String,

    /// HTTP client
    client: VersClient,

    /// Event receiver for SSE
    event_rx: Option<mpsc::UnboundedReceiver<ServerEvent>>,

    /// Current status
    pub status: AppStatus,

    /// Current view mode
    pub view_mode: ViewMode,

    /// Input mode
    pub input_mode: InputMode,

    /// Current input text
    pub input: String,

    /// Cursor position in input
    pub cursor_pos: usize,

    /// Conversation messages
    pub messages: Vec<Message>,

    /// Current streaming response
    pub current_response: String,

    /// Is currently streaming a response
    pub is_streaming: bool,

    /// Scroll offset for messages
    pub scroll_offset: usize,

    /// Agent name (e.g., "claude-opus")
    pub agent_name: Option<String>,

    /// Session ID
    pub session_id: Option<String>,

    /// Current mode (default, plan)
    pub mode: String,

    /// Should exit
    pub should_exit: bool,

    /// Canvas state for VM tree view
    pub canvas: CanvasState,
}

impl App {
    pub fn new(server_url: String) -> Self {
        Self {
            client: VersClient::new(server_url.clone()),
            server_url,
            event_rx: None,
            status: AppStatus::Connecting,
            view_mode: ViewMode::default(),
            input_mode: InputMode::Insert,
            input: String::new(),
            cursor_pos: 0,
            messages: Vec::new(),
            current_response: String::new(),
            is_streaming: false,
            scroll_offset: 0,
            agent_name: None,
            session_id: None,
            mode: "default".to_string(),
            should_exit: false,
            canvas: CanvasState::default(),
        }
    }

    /// Connect to the server
    pub async fn connect(&mut self) -> Result<()> {
        self.status = AppStatus::Connecting;

        // Claim the server
        let claim = self.client.claim().await?;
        if claim.is_owner != Some(true) {
            self.status = AppStatus::Error(
                claim
                    .error
                    .unwrap_or_else(|| "Failed to claim server".to_string()),
            );
            return Ok(());
        }

        // Initialize
        let agent_info = self.client.initialize().await?;
        self.agent_name = Some(agent_info.name);

        // Try to load existing session, or create new one
        let session = match self.client.load_recent_session().await? {
            Some(s) => s,
            None => self.client.new_session(None).await?,
        };
        self.session_id = Some(session.session_id);
        self.mode = session.mode;

        // Subscribe to events
        let (tx, rx) = mpsc::unbounded_channel();
        self.event_rx = Some(rx);
        self.client.subscribe_events(tx).await?;

        self.status = AppStatus::Connected;
        self.messages.push(Message {
            role: MessageRole::System,
            content: format!(
                "Connected to {} at {}\nType /canvas to view VMs, /help for commands",
                self.agent_name.as_deref().unwrap_or("agent"),
                self.server_url
            ),
        });

        Ok(())
    }

    /// Set an error state (for display in UI without crashing)
    pub fn set_error(&mut self, message: String) {
        self.status = AppStatus::Error(message.clone());
        self.messages.push(Message {
            role: MessageRole::System,
            content: format!("Error: {}", message),
        });
    }

    /// Process tick - check for server events
    pub async fn tick(&mut self) -> Result<()> {
        // Collect events first to avoid borrow issues
        let events: Vec<_> = if let Some(rx) = &mut self.event_rx {
            let mut events = Vec::new();
            while let Ok(event) = rx.try_recv() {
                events.push(event);
            }
            events
        } else {
            Vec::new()
        };

        // Then process them
        for event in events {
            self.handle_server_event(event);
        }
        Ok(())
    }

    /// Handle a server event
    fn handle_server_event(&mut self, event: ServerEvent) {
        match event {
            ServerEvent::Connected => {
                // Already handled in connect()
            }
            ServerEvent::ContentChunk { text, is_final } => {
                self.current_response.push_str(&text);
                self.is_streaming = !is_final;

                if is_final && !self.current_response.is_empty() {
                    // Move response to messages
                    self.messages.push(Message {
                        role: MessageRole::Assistant,
                        content: std::mem::take(&mut self.current_response),
                    });
                    self.status = AppStatus::Connected;
                }
            }
            ServerEvent::Completed { duration_ms: _ } => {
                self.is_streaming = false;
                self.status = AppStatus::Connected;

                // If there's remaining response, save it
                if !self.current_response.is_empty() {
                    self.messages.push(Message {
                        role: MessageRole::Assistant,
                        content: std::mem::take(&mut self.current_response),
                    });
                }
            }
            ServerEvent::ModeUpdate { mode } => {
                self.mode = mode;
            }
            ServerEvent::ToolUse { name, status } => {
                // Could show tool activity in UI
                tracing::debug!("Tool use: {} - {}", name, status);
            }
            ServerEvent::Error { message } => {
                self.status = AppStatus::Error(message);
                self.is_streaming = false;
            }
        }
    }

    /// Handle keyboard input, returns true if app should exit
    pub async fn handle_key(&mut self, key: KeyEvent) -> Result<bool> {
        // Global keybindings
        match (key.modifiers, key.code) {
            // Ctrl+C - cancel or exit
            (KeyModifiers::CONTROL, KeyCode::Char('c')) => {
                if self.is_streaming {
                    self.client.cancel().await?;
                    self.is_streaming = false;
                    self.status = AppStatus::Connected;
                } else if !self.input.is_empty() {
                    self.input.clear();
                    self.cursor_pos = 0;
                } else if self.view_mode == ViewMode::Canvas {
                    self.view_mode = ViewMode::Chat;
                } else {
                    return Ok(true); // Exit
                }
                return Ok(false);
            }
            // Ctrl+D - exit
            (KeyModifiers::CONTROL, KeyCode::Char('d')) => {
                return Ok(true);
            }
            _ => {}
        }

        // View-specific handling
        match self.view_mode {
            ViewMode::Chat => self.handle_chat_key(key).await?,
            ViewMode::Canvas => self.handle_canvas_key(key).await?,
        }

        Ok(false)
    }

    /// Handle keyboard input in chat view
    async fn handle_chat_key(&mut self, key: KeyEvent) -> Result<()> {
        match self.input_mode {
            InputMode::Insert => self.handle_insert_mode(key).await?,
            InputMode::Normal => self.handle_normal_mode(key).await?,
        }
        Ok(())
    }

    /// Handle keyboard input in canvas view
    async fn handle_canvas_key(&mut self, key: KeyEvent) -> Result<()> {
        match key.code {
            // Navigation
            KeyCode::Up | KeyCode::Char('k') => {
                self.canvas.select_prev();
            }
            KeyCode::Down | KeyCode::Char('j') => {
                self.canvas.select_next();
            }

            // Actions
            KeyCode::Enter => {
                // Connect to selected VM
                if let Some(vm_id) = self.canvas.selected_vm_id() {
                    let vm_id = vm_id.to_string();
                    self.connect_to_vm(&vm_id).await?;
                }
            }
            KeyCode::Char('c') => {
                // Create new VM
                self.create_vm(None).await?;
            }
            KeyCode::Char('b') => {
                // Branch from selected VM
                if let Some(vm_id) = self.canvas.selected_vm_id() {
                    let vm_id = vm_id.to_string();
                    self.branch_vm(&vm_id, None).await?;
                }
            }
            KeyCode::Char('d') => {
                // Delete selected VM
                if let Some(vm_id) = self.canvas.selected_vm_id() {
                    let vm_id = vm_id.to_string();
                    self.delete_vm(&vm_id).await?;
                }
            }
            KeyCode::Char('r') => {
                // Refresh VM list
                self.refresh_canvas().await?;
            }
            KeyCode::Char('p') => {
                // Ping selected VM to check if it's actually alive
                if let Some(vm_id) = self.canvas.selected_vm_id() {
                    let vm_id = vm_id.to_string();
                    self.ping_vm(&vm_id).await?;
                }
            }

            // Exit canvas
            KeyCode::Char('q') | KeyCode::Esc => {
                self.view_mode = ViewMode::Chat;
            }

            _ => {}
        }
        Ok(())
    }

    async fn handle_insert_mode(&mut self, key: KeyEvent) -> Result<()> {
        match (key.modifiers, key.code) {
            // Escape - switch to normal mode (optional, vi-style)
            (KeyModifiers::NONE, KeyCode::Esc) => {
                // For now, just cancel streaming if active
                if self.is_streaming {
                    self.client.cancel().await?;
                    self.is_streaming = false;
                }
            }

            // Enter - submit input
            (KeyModifiers::NONE, KeyCode::Enter) => {
                if !self.input.is_empty() && !self.is_streaming {
                    self.submit_input().await?;
                }
            }

            // Shift+Enter - newline
            (KeyModifiers::SHIFT, KeyCode::Enter) => {
                self.input.insert(self.cursor_pos, '\n');
                self.cursor_pos += 1;
            }

            // Backspace
            (KeyModifiers::NONE, KeyCode::Backspace) => {
                if self.cursor_pos > 0 {
                    self.cursor_pos -= 1;
                    self.input.remove(self.cursor_pos);
                }
            }

            // Delete
            (KeyModifiers::NONE, KeyCode::Delete) => {
                if self.cursor_pos < self.input.len() {
                    self.input.remove(self.cursor_pos);
                }
            }

            // Arrow keys
            (KeyModifiers::NONE, KeyCode::Left) => {
                self.cursor_pos = self.cursor_pos.saturating_sub(1);
            }
            (KeyModifiers::NONE, KeyCode::Right) => {
                self.cursor_pos = (self.cursor_pos + 1).min(self.input.len());
            }

            // Home/End
            (KeyModifiers::NONE, KeyCode::Home) | (KeyModifiers::CONTROL, KeyCode::Char('a')) => {
                self.cursor_pos = 0;
            }
            (KeyModifiers::NONE, KeyCode::End) | (KeyModifiers::CONTROL, KeyCode::Char('e')) => {
                self.cursor_pos = self.input.len();
            }

            // Ctrl+U - clear line
            (KeyModifiers::CONTROL, KeyCode::Char('u')) => {
                self.input.clear();
                self.cursor_pos = 0;
            }

            // Ctrl+W - delete word
            (KeyModifiers::CONTROL, KeyCode::Char('w')) => {
                // Delete word before cursor
                while self.cursor_pos > 0
                    && self
                        .input
                        .chars()
                        .nth(self.cursor_pos - 1)
                        .is_some_and(|c| c.is_whitespace())
                {
                    self.cursor_pos -= 1;
                    self.input.remove(self.cursor_pos);
                }
                while self.cursor_pos > 0
                    && self
                        .input
                        .chars()
                        .nth(self.cursor_pos - 1)
                        .is_some_and(|c| !c.is_whitespace())
                {
                    self.cursor_pos -= 1;
                    self.input.remove(self.cursor_pos);
                }
            }

            // Page Up/Down - scroll
            (KeyModifiers::NONE, KeyCode::PageUp) => {
                self.scroll_offset = self.scroll_offset.saturating_add(5);
            }
            (KeyModifiers::NONE, KeyCode::PageDown) => {
                self.scroll_offset = self.scroll_offset.saturating_sub(5);
            }

            // Regular character
            (KeyModifiers::NONE | KeyModifiers::SHIFT, KeyCode::Char(c)) => {
                self.input.insert(self.cursor_pos, c);
                self.cursor_pos += 1;
            }

            _ => {}
        }

        Ok(())
    }

    async fn handle_normal_mode(&mut self, key: KeyEvent) -> Result<()> {
        match key.code {
            KeyCode::Char('i') => {
                self.input_mode = InputMode::Insert;
            }
            KeyCode::Char('q') => {
                self.should_exit = true;
            }
            // Vim-style scrolling
            KeyCode::Char('j') => {
                self.scroll_offset = self.scroll_offset.saturating_sub(1);
            }
            KeyCode::Char('k') => {
                self.scroll_offset = self.scroll_offset.saturating_add(1);
            }
            _ => {}
        }
        Ok(())
    }

    /// Submit the current input
    async fn submit_input(&mut self) -> Result<()> {
        let text = std::mem::take(&mut self.input);
        self.cursor_pos = 0;

        // Check for commands
        if text.starts_with('/') {
            return self.handle_command(&text).await;
        }

        // Add user message
        self.messages.push(Message {
            role: MessageRole::User,
            content: text.clone(),
        });

        // Reset scroll to bottom
        self.scroll_offset = 0;

        // Send to server
        self.status = AppStatus::Processing;
        self.is_streaming = true;
        self.client.prompt(&text).await?;

        Ok(())
    }

    /// Handle slash commands
    async fn handle_command(&mut self, cmd: &str) -> Result<()> {
        let parts: Vec<&str> = cmd.split_whitespace().collect();
        let command = parts.first().map(|s| *s).unwrap_or("");

        match command {
            "/canvas" | "/vm" | "/vms" => {
                self.view_mode = ViewMode::Canvas;
                self.refresh_canvas().await?;
            }
            "/help" => {
                self.messages.push(Message {
                    role: MessageRole::System,
                    content: "Commands:\n\
                        /canvas, /vm  - Open VM canvas view\n\
                        /new          - Create new session\n\
                        /help         - Show this help\n\
                        \n\
                        In canvas view:\n\
                        ↑↓/jk - Navigate  Enter - Connect\n\
                        c - Create VM   b - Branch   d - Delete\n\
                        r - Refresh     q/Esc - Back to chat"
                        .to_string(),
                });
            }
            "/new" => {
                let session = self.client.new_session(None).await?;
                self.session_id = Some(session.session_id.clone());
                self.mode = session.mode;
                self.messages.clear();
                self.messages.push(Message {
                    role: MessageRole::System,
                    content: format!("New session: {}", &session.session_id[..8]),
                });
            }
            _ => {
                self.messages.push(Message {
                    role: MessageRole::System,
                    content: format!("Unknown command: {}. Type /help for commands.", command),
                });
            }
        }

        Ok(())
    }

    // ==================== VM Operations ====================

    /// Refresh the canvas with current VM list
    pub async fn refresh_canvas(&mut self) -> Result<()> {
        self.canvas.loading = true;
        self.canvas.error = None;

        match self.client.vm_list().await {
            Ok(vms) => {
                self.canvas.tree = TreeState::from_vm_list(vms);
                self.canvas.loading = false;
            }
            Err(e) => {
                self.canvas.error = Some(e.to_string());
                self.canvas.loading = false;
            }
        }

        Ok(())
    }

    /// Connect to a VM
    async fn connect_to_vm(&mut self, vm_id: &str) -> Result<()> {
        match self.client.vm_connect(vm_id).await {
            Ok(session) => {
                self.session_id = Some(session.session_id.clone());
                self.mode = session.mode;
                self.view_mode = ViewMode::Chat;
                self.messages.push(Message {
                    role: MessageRole::System,
                    content: format!("Connected to VM {}", &vm_id[..6.min(vm_id.len())]),
                });
            }
            Err(e) => {
                self.canvas.error = Some(format!("Failed to connect: {}", e));
            }
        }
        Ok(())
    }

    /// Create a new VM
    async fn create_vm(&mut self, task: Option<&str>) -> Result<()> {
        match self.client.vm_create(task).await {
            Ok(vm) => {
                self.messages.push(Message {
                    role: MessageRole::System,
                    content: format!("Created VM {}", &vm.vm_id[..6.min(vm.vm_id.len())]),
                });
                self.refresh_canvas().await?;
            }
            Err(e) => {
                self.canvas.error = Some(format!("Failed to create VM: {}", e));
            }
        }
        Ok(())
    }

    /// Branch from a VM
    async fn branch_vm(&mut self, vm_id: &str, approach: Option<&str>) -> Result<()> {
        match self.client.vm_branch(vm_id, approach).await {
            Ok(vm) => {
                self.messages.push(Message {
                    role: MessageRole::System,
                    content: format!(
                        "Branched VM {} from {}",
                        &vm.vm_id[..6.min(vm.vm_id.len())],
                        &vm_id[..6.min(vm_id.len())]
                    ),
                });
                self.refresh_canvas().await?;
            }
            Err(e) => {
                self.canvas.error = Some(format!("Failed to branch: {}", e));
            }
        }
        Ok(())
    }

    /// Delete a VM
    async fn delete_vm(&mut self, vm_id: &str) -> Result<()> {
        match self.client.vm_delete(vm_id).await {
            Ok(()) => {
                self.messages.push(Message {
                    role: MessageRole::System,
                    content: format!("Deleted VM {}", &vm_id[..6.min(vm_id.len())]),
                });
                self.refresh_canvas().await?;
            }
            Err(e) => {
                self.canvas.error = Some(format!("Failed to delete: {}", e));
            }
        }
        Ok(())
    }

    /// Ping a VM to check if it's actually accessible
    async fn ping_vm(&mut self, vm_id: &str) -> Result<()> {
        // Set up ping state
        self.canvas.pinged_vm_id = Some(vm_id.to_string());
        self.canvas.ping_result = None; // Show "pinging..."

        // Do the ping
        let is_alive = self.client.vm_ping(vm_id).await.unwrap_or(false);
        self.canvas.ping_result = Some(is_alive);

        Ok(())
    }
}
