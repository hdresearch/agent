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
use std::io::{stdout, Write};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use app::App;
use client::VersClient;
use event::{Event, EventHandler};

#[derive(Parser, Debug)]
#[command(name = "vers-tui")]
#[command(about = "Terminal UI for vers-agent", long_about = None)]
struct Args {
    /// Server URL to connect to (ignored if --cloud is used)
    #[arg(short, long, default_value = "http://localhost:9999")]
    url: String,

    /// Bootstrap server URL (used with --cloud to create VMs)
    #[arg(long, default_value = "http://localhost:9999")]
    bootstrap: String,

    /// Run on a fresh Vers VM (creates new VM and connects to it)
    #[arg(long)]
    cloud: bool,

    /// Enable debug logging
    #[arg(short, long)]
    debug: bool,
}

/// Provision a new VM via the bootstrap server and return its agent URL
async fn provision_cloud_vm(bootstrap_url: &str) -> Result<String> {
    print!("🚀 Creating Vers VM...");
    stdout().flush()?;

    let mut client = VersClient::new(bootstrap_url.to_string());

    // Claim and initialize bootstrap server
    let claim = client.claim().await?;
    if claim.is_owner != Some(true) {
        anyhow::bail!(
            "Cannot access bootstrap server: {}",
            claim.error.unwrap_or_else(|| "access denied".to_string())
        );
    }

    client.initialize().await?;

    // Create a new VM
    let vm = client.vm_create(Some("vers-tui session")).await?;
    println!(" VM {} created", &vm.vm_id[..8]);

    // Wait for VM to be ready (poll health endpoint)
    let vm_url = format!("https://{}.vm.vers.sh", vm.vm_id);
    print!("⏳ Waiting for VM to be ready...");
    stdout().flush()?;

    let health_url = format!("{}/health", vm_url);
    let http_client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true) // VM certs may not be fully set up
        .timeout(std::time::Duration::from_secs(5))
        .build()?;

    let mut attempts = 0;
    let max_attempts = 60; // 60 * 2s = 2 minutes max wait

    loop {
        attempts += 1;
        if attempts > max_attempts {
            anyhow::bail!("Timeout waiting for VM to become ready");
        }

        match http_client.get(&health_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                println!(" ready!");
                break;
            }
            _ => {
                print!(".");
                stdout().flush()?;
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    }

    Ok(vm_url)
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

    // Determine target URL
    let target_url = if args.cloud {
        // Provision a new VM before entering TUI mode
        match provision_cloud_vm(&args.bootstrap).await {
            Ok(url) => {
                println!("🔗 Connecting to {}", url);
                url
            }
            Err(e) => {
                eprintln!("❌ Failed to provision VM: {}", e);
                eprintln!("   Make sure vers-agent is running locally: bun run start --local");
                return Err(e);
            }
        }
    } else {
        args.url.clone()
    };

    // Setup terminal (no mouse capture to allow text selection for copy)
    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Create app and event handler
    let mut app = App::new(target_url);
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
