//! vers-tui: Terminal UI for vers-agent
//!
//! This is a Ratatui-based TUI that connects to a vers-agent server via HTTP.
//! It provides an interactive chat interface with Claude Code.

#![allow(clippy::print_stdout, clippy::print_stderr)] // CLI binary, not library

mod app;
mod client;
mod event;
mod ui;
mod vm;

use anyhow::Result;
use clap::Parser;
use crossterm::{
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;
use std::io::stdout;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use app::App;
use event::{Event, EventHandler};

#[derive(Parser, Debug)]
#[command(name = "vers-tui")]
#[command(about = "Terminal UI for vers-agent", long_about = None)]
struct Args {
    /// Server URL to connect to
    #[arg(short, long, default_value = "http://localhost:9999")]
    url: String,

    /// Enable debug logging
    #[arg(short, long)]
    debug: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Initialize logging
    if args.debug {
        tracing_subscriber::registry()
            .with(tracing_subscriber::fmt::layer())
            .with(tracing_subscriber::EnvFilter::new("debug"))
            .init();
    }

    // Setup terminal (no mouse capture to allow text selection for copy)
    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Create app and event handler
    let mut app = App::new(args.url);
    let event_handler = EventHandler::new(250); // 250ms tick rate

    // Connect to server (don't fail if connection fails - show error in UI)
    if let Err(e) = app.connect().await {
        app.set_error(format!("Connection failed: {}", e));
    }

    // Run the main loop
    let res = run_app(&mut terminal, &mut app, event_handler).await;

    // Restore terminal
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    if let Err(err) = res {
        eprintln!("Error: {err:?}");
        return Err(err);
    }

    Ok(())
}

async fn run_app<B: Backend>(
    terminal: &mut Terminal<B>,
    app: &mut App,
    mut events: EventHandler,
) -> Result<()> {
    loop {
        // Draw the UI
        terminal.draw(|frame| ui::render(frame, app))?;

        // Handle events
        match events.next().await? {
            Event::Tick => {
                // Check for server updates
                app.tick().await?;
            }
            Event::Key(key_event) => {
                // Handle keyboard input
                if app.handle_key(key_event).await? {
                    // App signaled exit
                    return Ok(());
                }
            }
            Event::Mouse(_) => {
                // Ignore mouse events for now
            }
            Event::Resize(_, _) => {
                // Terminal will redraw on next iteration
            }
        }
    }
}
