use std::fs;
use std::path::Path;

fn push_u16(buf: &mut Vec<u8>, value: u16) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(buf: &mut Vec<u8>, value: u32) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn ensure_windows_icon() {
    let icon_path = Path::new("icons/icon.ico");
    if icon_path.exists() {
        return;
    }

    let _ = fs::create_dir_all("icons");
    const W: usize = 32;
    const H: usize = 32;

    let mut rgba = vec![[25u8, 35u8, 55u8, 255u8]; W * H];
    let white = [255u8, 255u8, 255u8, 255u8];

    let mut set = |x: usize, y: usize| {
        if x < W && y < H {
            rgba[y * W + x] = white;
        }
    };

    for y in 8..24 {
        for x in 6..9 {
            set(x, y);
        }
    }
    for x in 8..15 {
        for y in 7..10 {
            set(x, y);
        }
        for y in 22..25 {
            set(x, y);
        }
    }

    for y in 7..25 {
        for x in 18..21 {
            set(x, y);
        }
        for x in 25..28 {
            set(x, y);
        }
    }
    for y in 14..18 {
        for x in 20..26 {
            set(x, y);
        }
    }

    let xor_bytes = (W * H * 4) as u32;
    let and_row_bytes = ((W + 31) / 32 * 4) as u32;
    let and_bytes = and_row_bytes * H as u32;
    let image_bytes = 40 + xor_bytes + and_bytes;

    let mut ico = Vec::with_capacity(22 + image_bytes as usize);
    push_u16(&mut ico, 0);
    push_u16(&mut ico, 1);
    push_u16(&mut ico, 1);
    ico.push(W as u8);
    ico.push(H as u8);
    ico.push(0);
    ico.push(0);
    push_u16(&mut ico, 1);
    push_u16(&mut ico, 32);
    push_u32(&mut ico, image_bytes);
    push_u32(&mut ico, 22);

    push_u32(&mut ico, 40);
    push_u32(&mut ico, W as u32);
    push_u32(&mut ico, (H * 2) as u32);
    push_u16(&mut ico, 1);
    push_u16(&mut ico, 32);
    push_u32(&mut ico, 0);
    push_u32(&mut ico, xor_bytes);
    push_u32(&mut ico, 0);
    push_u32(&mut ico, 0);
    push_u32(&mut ico, 0);
    push_u32(&mut ico, 0);

    for y in (0..H).rev() {
        for x in 0..W {
            let [r, g, b, a] = rgba[y * W + x];
            ico.extend_from_slice(&[b, g, r, a]);
        }
    }
    ico.resize(ico.len() + and_bytes as usize, 0);

    fs::write(icon_path, ico).expect("failed to generate icons/icon.ico");
}

fn main() {
    ensure_windows_icon();
    tauri_build::build()
}
