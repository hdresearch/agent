//! UI rendering with Ratatui

mod canvas;
mod input;
mod messages;
mod status;

pub use canvas::{render_canvas, CanvasState};

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph, Wrap},
};

use crate::app::{App, AppStatus, ViewMode};

/// Render the entire UI
pub fn render(frame: &mut Frame, app: &App) {
    let area = frame.area();

    match app.view_mode {
        ViewMode::Chat => render_chat_view(frame, app, area),
        ViewMode::Canvas => render_canvas(frame, &app.canvas, area),
    }
}

/// Render the chat view
fn render_chat_view(frame: &mut Frame, app: &App, area: Rect) {
    // Main layout: status bar, messages, input
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Top status bar
            Constraint::Min(1),    // Messages area
            Constraint::Length(5), // Input area
        ])
        .split(area);

    // Render components
    render_status_bar(frame, app, chunks[0]);
    render_messages(frame, app, chunks[1]);
    render_input(frame, app, chunks[2]);
}

/// Render the top status bar
fn render_status_bar(frame: &mut Frame, app: &App, area: Rect) {
    let status_color = match &app.status {
        AppStatus::Connecting => Color::Yellow,
        AppStatus::Connected => Color::Green,
        AppStatus::Processing => Color::Cyan,
        AppStatus::Error(_) => Color::Red,
    };

    let status_text = match &app.status {
        AppStatus::Connecting => "connecting...".to_string(),
        AppStatus::Connected => format!(
            "{} @ {} │ {}",
            app.agent_name.as_deref().unwrap_or("agent"),
            app.server_url.replace("http://", ""),
            app.session_id
                .as_ref()
                .map_or("no session", |s| &s[..8.min(s.len())])
        ),
        AppStatus::Processing => "processing...".to_string(),
        AppStatus::Error(e) => format!("error: {}", e),
    };

    let indicator = if app.is_streaming { "◐" } else { "●" };

    let status = Paragraph::new(Line::from(vec![
        Span::styled(
            format!("{} ", indicator),
            Style::default().fg(status_color).bold(),
        ),
        Span::styled(status_text, Style::default().fg(Color::White)),
        Span::raw(" │ "),
        Span::styled(
            format!("mode: {}", app.mode),
            Style::default().fg(Color::DarkGray),
        ),
    ]))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::DarkGray))
            .border_type(ratatui::widgets::BorderType::Rounded),
    );

    frame.render_widget(status, area);
}

/// Render the messages area
fn render_messages(frame: &mut Frame, app: &App, area: Rect) {
    use crate::app::MessageRole;

    let inner_height = area.height.saturating_sub(2) as usize;

    // Build lines from messages
    let mut lines: Vec<Line> = Vec::new();

    for msg in &app.messages {
        let (prefix, style) = match msg.role {
            MessageRole::User => ("❯ ", Style::default().fg(Color::Cyan).bold()),
            MessageRole::Assistant => ("⏺ ", Style::default().fg(Color::Magenta).bold()),
            MessageRole::System => ("  ", Style::default().fg(Color::DarkGray)),
        };

        // Add message lines
        for (i, line) in msg.content.lines().enumerate() {
            if i == 0 {
                lines.push(Line::from(vec![
                    Span::styled(prefix, style),
                    Span::raw(line),
                ]));
            } else {
                lines.push(Line::from(vec![
                    Span::raw("   "),
                    Span::raw(line),
                ]));
            }
        }
        lines.push(Line::from("")); // Spacing between messages
    }

    // Add current streaming response
    if !app.current_response.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("⏺ ", Style::default().fg(Color::Magenta).bold()),
            Span::raw(&app.current_response),
        ]));
        if app.is_streaming {
            lines.push(Line::from(Span::styled(
                "   ...",
                Style::default().fg(Color::DarkGray),
            )));
        }
    }

    // Calculate scroll
    let total_lines = lines.len();
    let scroll = if total_lines > inner_height {
        let max_scroll = total_lines - inner_height;
        max_scroll.saturating_sub(app.scroll_offset)
    } else {
        0
    };

    let messages = Paragraph::new(lines)
        .wrap(Wrap { trim: false })
        .scroll((scroll as u16, 0))
        .block(
            Block::default()
                .borders(Borders::LEFT | Borders::RIGHT)
                .border_style(Style::default().fg(Color::DarkGray)),
        );

    frame.render_widget(messages, area);
}

/// Render the input area
fn render_input(frame: &mut Frame, app: &App, area: Rect) {
    let input_style = if app.is_streaming {
        Style::default().fg(Color::DarkGray)
    } else {
        Style::default().fg(Color::White)
    };

    let prompt = if app.is_streaming {
        "⏳ "
    } else {
        "❯ "
    };

    let input_text = if app.input.is_empty() && !app.is_streaming {
        "Type a message...".to_string()
    } else {
        app.input.clone()
    };

    let display_style = if app.input.is_empty() && !app.is_streaming {
        Style::default().fg(Color::DarkGray)
    } else {
        input_style
    };

    let input = Paragraph::new(Line::from(vec![
        Span::styled(prompt, Style::default().fg(Color::Green).bold()),
        Span::styled(input_text, display_style),
    ]))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::DarkGray))
            .border_type(ratatui::widgets::BorderType::Rounded)
            .title(Span::styled(
                " Enter: send │ Shift+Enter: newline │ Ctrl+C: clear/exit ",
                Style::default().fg(Color::DarkGray),
            ))
            .title_position(ratatui::widgets::block::Position::Bottom),
    );

    frame.render_widget(input, area);

    // Position cursor
    if !app.is_streaming {
        let cursor_x = area.x + 3 + app.cursor_pos as u16; // 3 = border + prompt
        let cursor_y = area.y + 1;
        frame.set_cursor_position(Position::new(cursor_x, cursor_y));
    }
}
