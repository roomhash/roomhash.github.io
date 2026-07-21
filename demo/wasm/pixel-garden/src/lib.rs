#![no_std]

use core::panic::PanicInfo;

const GRID_SIZE: usize = 32;
const CELL_COUNT: usize = GRID_SIZE * GRID_SIZE;

#[derive(Clone, Copy)]
#[repr(C)]
struct Cell {
    actor: u32,
    flower: u32,
    clock: u32,
}

const EMPTY: Cell = Cell {
    actor: 0,
    flower: 0,
    clock: 0,
};

static mut CELLS: [Cell; CELL_COUNT] = [EMPTY; CELL_COUNT];

fn cell_ptr(index: usize) -> *mut Cell {
    let base = core::ptr::addr_of_mut!(CELLS) as *mut Cell;
    unsafe { base.add(index) }
}

#[no_mangle]
pub extern "C" fn grid_size() -> u32 {
    GRID_SIZE as u32
}

#[no_mangle]
pub extern "C" fn reset() {
    for index in 0..CELL_COUNT {
        unsafe { *cell_ptr(index) = EMPTY; }
    }
}

#[no_mangle]
pub extern "C" fn apply_event(index: u32, flower: u32, clock: u32, actor: u32) -> u32 {
    let index = index as usize;
    if index >= CELL_COUNT || flower == 0 || actor == 0 || clock == 0 {
        return 0;
    }

    let cell = unsafe { &mut *cell_ptr(index) };
    let newer = clock > cell.clock || (clock == cell.clock && actor > cell.actor);
    if !newer {
        return 0;
    }

    *cell = Cell { actor, flower, clock };
    1
}

#[no_mangle]
pub extern "C" fn cell_actor(index: u32) -> u32 {
    if index as usize >= CELL_COUNT { return 0; }
    unsafe { (*cell_ptr(index as usize)).actor }
}

#[no_mangle]
pub extern "C" fn cell_flower(index: u32) -> u32 {
    if index as usize >= CELL_COUNT { return 0; }
    unsafe { (*cell_ptr(index as usize)).flower }
}

#[no_mangle]
pub extern "C" fn cell_clock(index: u32) -> u32 {
    if index as usize >= CELL_COUNT { return 0; }
    unsafe { (*cell_ptr(index as usize)).clock }
}

fn hash_word(mut hash: u32, value: u32) -> u32 {
    for byte in value.to_le_bytes() {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    hash
}

#[no_mangle]
pub extern "C" fn state_hash() -> u32 {
    let mut hash = 2_166_136_261_u32;
    for index in 0..CELL_COUNT {
        let cell = unsafe { *cell_ptr(index) };
        hash = hash_word(hash, cell.actor);
        hash = hash_word(hash, cell.flower);
        hash = hash_word(hash, cell.clock);
    }
    hash
}

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}
