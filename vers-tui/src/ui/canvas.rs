//! Canvas view - VM branch tree visualization
//!
//! Renders the DAG tree of VMs with status, navigation, and actions.

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph},
};

use crate::vm::{TreeNode, TreeState};

/// Canvas view state
pub struct CanvasState {
    /// The tree state
    pub tree: TreeState,
    /// Currently selected index in flattened tree
    pub selected_index: usize,
    /// Whether the canvas is loading
    pub loading: bool,
    /// Error message if any
    pub error: Option<String>,
    /// Ping result for selected VM (None = not pinged, Some(true) = alive, Some(false) = dead)
    pub ping_result: Option<bool>,
    /// VM ID that was pinged (to show result for correct VM)
    pub pinged_vm_id: Option<String>,
}

impl Default for CanvasState {
    fn default() -> Self {
        Self {
            tree: TreeState::default(),
            selected_index: 0,
            loading: true,
            error: None,
            ping_result: None,
            pinged_vm_id: None,
        }
    }
}

impl CanvasState {
    /// Move selection up
    pub fn select_prev(&mut self) {
        if self.selected_index > 0 {
            self.selected_index -= 1;
        }
    }

    /// Move selection down
    pub fn select_next(&mut self) {
        let max = self.tree.flatten().len().saturating_sub(1);
        if self.selected_index < max {
            self.selected_index += 1;
        }
    }

    /// Get the currently selected node
    pub fn selected_node(&self) -> Option<&TreeNode> {
        self.tree.flatten().get(self.selected_index).copied()
    }

    /// Get selected VM ID
    pub fn selected_vm_id(&self) -> Option<&str> {
        self.selected_node().map(|n| n.vm_id.as_str())
    }
}

/// Render the canvas view
pub fn render_canvas(frame: &mut Frame, state: &CanvasState, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Header
            Constraint::Min(1),    // Tree
            Constraint::Length(3), // Footer/help
        ])
        .split(area);

    render_header(frame, state, chunks[0]);
    render_tree(frame, state, chunks[1]);
    render_footer(frame, chunks[2]);
}

/// Render the canvas header with stats
fn render_header(frame: &mut Frame, state: &CanvasState, area: Rect) {
    let tree = &state.tree;

    let status_text = if state.loading {
        "Loading...".to_string()
    } else if let Some(ref err) = state.error {
        format!("Error: {}", err)
    } else {
        format!(
            "{} VMs • {} running • {} done • {} failed",
            tree.total_vms, tree.running_count, tree.completed_count, tree.failed_count
        )
    };

    let header = Paragraph::new(Line::from(vec![
        Span::styled("Vers Canvas", Style::default().fg(Color::Cyan).bold()),
        Span::raw("  "),
        Span::styled(status_text, Style::default().fg(Color::DarkGray)),
    ]))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::DarkGray))
            .border_type(ratatui::widgets::BorderType::Rounded),
    );

    frame.render_widget(header, area);
}

/// Render the tree view
fn render_tree(frame: &mut Frame, state: &CanvasState, area: Rect) {
    if state.loading {
        let loading = Paragraph::new("Loading VMs...")
            .style(Style::default().fg(Color::DarkGray))
            .block(Block::default().borders(Borders::LEFT | Borders::RIGHT));
        frame.render_widget(loading, area);
        return;
    }

    if state.tree.total_vms == 0 {
        let empty = Paragraph::new(vec![
            Line::from("No VMs found."),
            Line::from(""),
            Line::from(Span::styled(
                "Press 'c' to create a new VM",
                Style::default().fg(Color::DarkGray),
            )),
        ])
        .block(Block::default().borders(Borders::LEFT | Borders::RIGHT));
        frame.render_widget(empty, area);
        return;
    }

    // Build lines from tree
    let mut lines: Vec<Line> = Vec::new();
    let flat_nodes = state.tree.flatten();

    for (idx, node) in flat_nodes.iter().enumerate() {
        let is_selected = idx == state.selected_index;
        let line = render_node_line(node, is_selected);
        lines.push(line);

        // Add detail line for selected node
        if is_selected {
            lines.push(render_node_details(node, state));
        }
    }

    let inner_height = area.height.saturating_sub(2) as usize;
    let scroll = if lines.len() > inner_height {
        // Keep selected item visible
        let selected_line = state.selected_index.min(lines.len().saturating_sub(1));
        selected_line.saturating_sub(inner_height / 2)
    } else {
        0
    };

    let tree_widget = Paragraph::new(lines)
        .scroll((scroll as u16, 0))
        .block(
            Block::default()
                .borders(Borders::LEFT | Borders::RIGHT)
                .border_style(Style::default().fg(Color::DarkGray)),
        );

    frame.render_widget(tree_widget, area);
}

/// Render a single node line
fn render_node_line(node: &TreeNode, is_selected: bool) -> Line<'static> {
    let indent = "  ".repeat(node.depth);
    let connector = if node.depth > 0 { "├── " } else { "" };

    let icon = node.status.icon();
    let color = node.status.color();
    let duration = node.format_duration();

    let mut spans = vec![
        Span::raw(indent),
        Span::raw(connector.to_string()),
        Span::styled(icon.to_string(), Style::default().fg(color)),
        Span::raw(" "),
    ];

    // Short ID with selection highlight
    let id_style = if is_selected {
        Style::default().bg(Color::Blue).bold()
    } else {
        Style::default()
    };
    spans.push(Span::styled(format!("[{}]", node.short_id), id_style));

    spans.push(Span::raw(" "));
    spans.push(Span::styled(
        node.label().to_string(),
        Style::default().fg(Color::White),
    ));
    spans.push(Span::raw("  "));
    spans.push(Span::styled(
        format!("{:?}", node.status).to_lowercase(),
        Style::default().fg(color),
    ));
    spans.push(Span::raw("  "));
    spans.push(Span::styled(duration, Style::default().fg(Color::DarkGray)));

    Line::from(spans)
}

/// Render details for selected node
fn render_node_details(node: &TreeNode, state: &CanvasState) -> Line<'static> {
    let indent = "  ".repeat(node.depth + 1);
    let mut spans = vec![Span::raw(indent)];

    // Show ping result if this VM was pinged
    let ping_for_this_vm = state
        .pinged_vm_id
        .as_ref()
        .is_some_and(|id| id == &node.vm_id);

    if ping_for_this_vm {
        match state.ping_result {
            Some(true) => {
                spans.push(Span::styled("✓ ALIVE  ", Style::default().fg(Color::Green).bold()));
            }
            Some(false) => {
                spans.push(Span::styled("✗ DEAD  ", Style::default().fg(Color::Red).bold()));
            }
            None => {
                spans.push(Span::styled("⏳ pinging...  ", Style::default().fg(Color::Yellow)));
            }
        }
    }

    // Show URLs
    spans.push(Span::styled("🔗 ", Style::default().fg(Color::Cyan)));
    spans.push(Span::styled(
        node.shell_url.clone(),
        Style::default().fg(Color::Cyan).underlined(),
    ));
    spans.push(Span::raw("  "));
    spans.push(Span::styled("🌐 ", Style::default().fg(Color::Magenta)));
    spans.push(Span::styled(
        node.app_url.clone(),
        Style::default().fg(Color::Magenta).underlined(),
    ));

    // Add activity or error
    if let Some(ref error) = node.error {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(error.clone(), Style::default().fg(Color::Red)));
    } else if let Some(ref activity) = node.last_activity {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(
            activity.clone(),
            Style::default().fg(Color::DarkGray),
        ));
    }

    Line::from(spans)
}

/// Render the footer with keyboard shortcuts
fn render_footer(frame: &mut Frame, area: Rect) {
    let help = Paragraph::new(Line::from(vec![
        Span::styled("[↑↓]", Style::default().fg(Color::Yellow)),
        Span::raw(" Nav  "),
        Span::styled("[p]", Style::default().fg(Color::Yellow)),
        Span::raw(" Ping  "),
        Span::styled("[Enter]", Style::default().fg(Color::Yellow)),
        Span::raw(" Connect  "),
        Span::styled("[c]", Style::default().fg(Color::Yellow)),
        Span::raw(" Create  "),
        Span::styled("[b]", Style::default().fg(Color::Yellow)),
        Span::raw(" Branch  "),
        Span::styled("[d]", Style::default().fg(Color::Yellow)),
        Span::raw(" Delete  "),
        Span::styled("[r]", Style::default().fg(Color::Yellow)),
        Span::raw(" Refresh  "),
        Span::styled("[q]", Style::default().fg(Color::Yellow)),
        Span::raw(" Back"),
    ]))
    .style(Style::default().fg(Color::DarkGray))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::DarkGray))
            .border_type(ratatui::widgets::BorderType::Rounded),
    );

    frame.render_widget(help, area);
}
