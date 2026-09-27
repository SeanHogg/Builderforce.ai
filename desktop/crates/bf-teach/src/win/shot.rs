//! A screenshot per recorded step, so review shows what the screen looked like. Scaled
//! down and JPEG-compressed: these are for a person to recognise the moment, not pixels to
//! replay from.

use super::err;
use anyhow::Result;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::DynamicImage;
use std::path::Path;

const MAX_WIDTH: u32 = 1280;
const QUALITY: u8 = 70;

/// Capture the monitor containing (`x`, `y`) into `dir/<name>.jpg`. Returns the file name.
pub fn capture(x: i32, y: i32, dir: &Path, name: &str) -> Result<String> {
    let monitor = xcap::Monitor::from_point(x, y).map_err(err)?;
    let img = DynamicImage::ImageRgba8(monitor.capture_image().map_err(err)?);
    let img = if img.width() > MAX_WIDTH {
        let h = (u64::from(img.height()) * u64::from(MAX_WIDTH) / u64::from(img.width())) as u32;
        img.resize(MAX_WIDTH, h, FilterType::Triangle)
    } else {
        img
    };
    std::fs::create_dir_all(dir)?;
    let file = format!("{name}.jpg");
    let mut out = std::io::BufWriter::new(std::fs::File::create(dir.join(&file))?);
    img.to_rgb8().write_with_encoder(JpegEncoder::new_with_quality(&mut out, QUALITY)).map_err(err)?;
    Ok(file)
}
