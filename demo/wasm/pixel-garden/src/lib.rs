#![no_std]

use core::panic::PanicInfo;

const GRID: usize = 32;
const CELL: usize = 8;
const WIDTH: usize = GRID * CELL;
const HEIGHT: usize = GRID * CELL;
const PIXELS: usize = WIDTH * HEIGHT * 4;

#[derive(Clone, Copy)]
struct GardenCell {
    actor: u32,
    flower: u32,
    clock: u32,
}

const EMPTY: GardenCell = GardenCell { actor: 0, flower: 0, clock: 0 };
static mut CELLS: [GardenCell; GRID * GRID] = [EMPTY; GRID * GRID];
static mut FRAMEBUFFER: [u8; PIXELS] = [0; PIXELS];

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

fn set_pixel(x: usize, y: usize, color: [u8; 4]) {
    if x >= WIDTH || y >= HEIGHT { return; }
    let offset = (y * WIDTH + x) * 4;
    unsafe {
        let ptr = core::ptr::addr_of_mut!(FRAMEBUFFER) as *mut u8;
        *ptr.add(offset) = color[0];
        *ptr.add(offset + 1) = color[1];
        *ptr.add(offset + 2) = color[2];
        *ptr.add(offset + 3) = color[3];
    }
}

fn get_cell(index: usize) -> GardenCell {
    if index >= GRID * GRID { return EMPTY; }
    unsafe { *((core::ptr::addr_of!(CELLS) as *const GardenCell).add(index)) }
}

fn put_cell(index: usize, cell: GardenCell) {
    if index >= GRID * GRID { return; }
    unsafe { *((core::ptr::addr_of_mut!(CELLS) as *mut GardenCell).add(index)) = cell; }
}

fn flower_color(flower: u32) -> [u8; 4] {
    match flower {
        1 => [245, 184, 75, 255],
        2 => [81, 215, 183, 255],
        3 => [255, 123, 114, 255],
        4 => [116, 185, 255, 255],
        _ => [0, 0, 0, 0],
    }
}

fn render() {
    let mut y = 0;
    while y < HEIGHT {
        let mut x = 0;
        while x < WIDTH {
            let shade = if ((x / CELL) + (y / CELL)) % 2 == 0 { 31 } else { 35 };
            set_pixel(x, y, [22, shade, 27, 255]);
            x += 1;
        }
        y += 1;
    }

    let mut index = 0;
    while index < GRID * GRID {
        let cell = get_cell(index);
        if cell.flower != 0 {
            let cx = (index % GRID) * CELL + 4;
            let cy = (index / GRID) * CELL + 3;
            let color = flower_color(cell.flower);
            set_pixel(cx, cy, [245, 238, 196, 255]);
            set_pixel(cx - 1, cy, color);
            set_pixel(cx + 1, cy, color);
            set_pixel(cx, cy - 1, color);
            set_pixel(cx, cy + 1, color);
            set_pixel(cx, cy + 2, [64, 156, 91, 255]);
            set_pixel(cx, cy + 3, [64, 156, 91, 255]);
        }
        index += 1;
    }
}

#[no_mangle] pub extern "C" fn rh_abi_version() -> u32 { 1 }
#[no_mangle] pub extern "C" fn rh_width() -> u32 { WIDTH as u32 }
#[no_mangle] pub extern "C" fn rh_height() -> u32 { HEIGHT as u32 }
#[no_mangle] pub extern "C" fn rh_framebuffer_ptr() -> u32 { core::ptr::addr_of!(FRAMEBUFFER) as *const u8 as usize as u32 }
#[no_mangle] pub extern "C" fn rh_framebuffer_len() -> u32 { PIXELS as u32 }
#[no_mangle] pub extern "C" fn rh_cell_count() -> u32 { (GRID * GRID) as u32 }

#[no_mangle]
pub extern "C" fn rh_init() { render(); }

#[no_mangle]
pub extern "C" fn rh_apply_event(x: u32, y: u32, flower: u32, actor: u32, clock: u32) -> u32 {
    if x >= GRID as u32 || y >= GRID as u32 || flower > 4 { return 0; }
    let index = y as usize * GRID + x as usize;
    let current = get_cell(index);
    if clock < current.clock || (clock == current.clock && actor <= current.actor) { return 0; }
    put_cell(index, GardenCell { actor, flower, clock });
    render();
    1
}

#[no_mangle]
pub extern "C" fn rh_input(x: u32, y: u32, flower: u32, actor: u32, clock: u32) -> u32 {
    rh_apply_event(x, y, flower, actor, clock)
}

#[no_mangle] pub extern "C" fn rh_cell_actor(index: u32) -> u32 { get_cell(index as usize).actor }
#[no_mangle] pub extern "C" fn rh_cell_flower(index: u32) -> u32 { get_cell(index as usize).flower }
#[no_mangle] pub extern "C" fn rh_cell_clock(index: u32) -> u32 { get_cell(index as usize).clock }
