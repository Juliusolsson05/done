//! done on a Mac. The app itself is the library beside this file; this is
//! only how it is started.
//!
//! The same program is also done's MCP server: started as `done mcp` it opens
//! no window and talks to an AI agent over standard input and output instead.
//! One program, so "connect an agent" is one path with nothing extra to install.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("mcp") {
        let store = done_core::Store::open(&done_core::default_path()).expect("open the tasks file");
        let stdin = std::io::stdin();
        done_mcp::serve(&store, stdin.lock(), std::io::stdout()).expect("serve MCP");
        return;
    }
    done_app_lib::run();
}
