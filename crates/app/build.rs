fn main() {
    // On iOS this crate calls three Swift functions that live in the app target
    // (gen/apple/Sources/done-app/DoneNative.swift, `done_focus`,
    // `done_widget_snapshot` and `done_apple_sign_in`). The app links the static library, where the
    // linker joins them by name. The crate is also built as a cdylib (for
    // Android; Tauri's template asks for all three kinds), and that iOS cdylib
    // is linked on its own, without the Swift code, so these names would be
    // undefined and fail the build. They are left to be found at load time
    // there instead; the cdylib is never loaded on iOS.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        println!("cargo:rustc-cdylib-link-arg=-Wl,-U,_done_focus");
        println!("cargo:rustc-cdylib-link-arg=-Wl,-U,_done_widget_snapshot");
        println!("cargo:rustc-cdylib-link-arg=-Wl,-U,_done_apple_sign_in");
    }
    tauri_build::build()
}
