#![no_std]

use core::panic::PanicInfo;

static MESSAGE: &[u8] = b"Hello from Rust + WebAssembly inside RoomHash!";

#[no_mangle]
pub extern "C" fn message_ptr() -> *const u8 {
    MESSAGE.as_ptr()
}

#[no_mangle]
pub extern "C" fn message_len() -> usize {
    MESSAGE.len()
}

#[no_mangle]
pub extern "C" fn answer() -> i32 {
    42
}

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}
