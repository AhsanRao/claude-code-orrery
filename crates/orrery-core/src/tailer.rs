//! Byte-offset tailing of append-only files.
//!
//! Claude Code appends one JSON object per line. We remember how far we have
//! read and only ever read the bytes after that, so a multi-megabyte transcript
//! costs nothing to follow. Files are opened read-only and closed immediately.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Tracks one file's read position and any trailing partial line.
#[derive(Debug)]
pub struct FileTail {
    path: PathBuf,
    offset: u64,
    partial: Vec<u8>,
}

impl FileTail {
    /// Follow `path` from the beginning (history is replayed on first read).
    pub fn from_start(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            offset: 0,
            partial: Vec::new(),
        }
    }

    /// Follow `path` from its current end (only new lines are reported).
    pub fn from_end(path: impl Into<PathBuf>) -> io::Result<Self> {
        let path = path.into();
        let offset = std::fs::metadata(&path)?.len();
        Ok(Self {
            path,
            offset,
            partial: Vec::new(),
        })
    }

    /// Follow `path`, but if it is larger than `max_bytes`, skip ahead so at
    /// most that much history is replayed. Used to bound startup cost on
    /// very long sessions.
    pub fn from_start_bounded(path: impl Into<PathBuf>, max_bytes: u64) -> io::Result<Self> {
        let path = path.into();
        let len = std::fs::metadata(&path)?.len();
        let mut tail = Self {
            path,
            offset: 0,
            partial: Vec::new(),
        };
        if len > max_bytes {
            tail.offset = len - max_bytes;
            tail.skip_partial_line()?;
        }
        Ok(tail)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn offset(&self) -> u64 {
        self.offset
    }

    /// Read every complete line appended since the last call.
    ///
    /// If the file shrank (rotated or rewritten), reading restarts from zero.
    /// A missing file is not an error; it simply yields no lines.
    pub fn read_new_lines(&mut self) -> io::Result<Vec<String>> {
        let mut file = match File::open(&self.path) {
            Ok(f) => f,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        let len = file.metadata()?.len();
        if len < self.offset {
            self.offset = 0;
            self.partial.clear();
        }
        if len == self.offset {
            return Ok(Vec::new());
        }
        file.seek(SeekFrom::Start(self.offset))?;
        let mut buf = Vec::with_capacity((len - self.offset) as usize);
        file.read_to_end(&mut buf)?;
        self.offset = len;

        let mut data = std::mem::take(&mut self.partial);
        data.extend_from_slice(&buf);
        let mut lines = Vec::new();
        let mut start = 0;
        for (i, b) in data.iter().enumerate() {
            if *b == b'\n' {
                lines.push(String::from_utf8_lossy(&data[start..i]).into_owned());
                start = i + 1;
            }
        }
        self.partial = data[start..].to_vec();
        Ok(lines)
    }

    /// After jumping into the middle of a file, advance to the next newline so
    /// we never emit half a record.
    fn skip_partial_line(&mut self) -> io::Result<()> {
        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(self.offset))?;
        let mut chunk = [0u8; 8192];
        loop {
            let n = file.read(&mut chunk)?;
            if n == 0 {
                return Ok(());
            }
            if let Some(i) = chunk[..n].iter().position(|b| *b == b'\n') {
                self.offset += (i + 1) as u64;
                return Ok(());
            }
            self.offset += n as u64;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_file(contents: &str) -> tempfile::NamedTempFile {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(contents.as_bytes()).unwrap();
        f.flush().unwrap();
        f
    }

    #[test]
    fn reads_history_then_only_appends() {
        let f = temp_file("a\nb\n");
        let mut tail = FileTail::from_start(f.path());
        assert_eq!(tail.read_new_lines().unwrap(), vec!["a", "b"]);
        assert!(tail.read_new_lines().unwrap().is_empty());

        let mut w = std::fs::OpenOptions::new()
            .append(true)
            .open(f.path())
            .unwrap();
        w.write_all(b"c\n").unwrap();
        assert_eq!(tail.read_new_lines().unwrap(), vec!["c"]);
    }

    #[test]
    fn keeps_partial_line_until_newline_arrives() {
        let f = temp_file("a\npar");
        let mut tail = FileTail::from_start(f.path());
        assert_eq!(tail.read_new_lines().unwrap(), vec!["a"]);
        let mut w = std::fs::OpenOptions::new()
            .append(true)
            .open(f.path())
            .unwrap();
        w.write_all(b"tial\n").unwrap();
        assert_eq!(tail.read_new_lines().unwrap(), vec!["partial"]);
    }

    #[test]
    fn from_end_skips_existing_content() {
        let f = temp_file("old\n");
        let mut tail = FileTail::from_end(f.path()).unwrap();
        assert!(tail.read_new_lines().unwrap().is_empty());
        let mut w = std::fs::OpenOptions::new()
            .append(true)
            .open(f.path())
            .unwrap();
        w.write_all(b"new\n").unwrap();
        assert_eq!(tail.read_new_lines().unwrap(), vec!["new"]);
    }

    #[test]
    fn bounded_start_aligns_to_line_boundary() {
        let f = temp_file("line-one\nline-two\nline-three\n");
        let mut tail = FileTail::from_start_bounded(f.path(), 12).unwrap();
        // 12 bytes from the end lands inside "line-two"; we skip to "line-three".
        assert_eq!(tail.read_new_lines().unwrap(), vec!["line-three"]);
    }

    #[test]
    fn truncation_restarts_from_zero() {
        let f = temp_file("one\ntwo\n");
        let mut tail = FileTail::from_start(f.path());
        tail.read_new_lines().unwrap();
        std::fs::write(f.path(), "x\n").unwrap();
        assert_eq!(tail.read_new_lines().unwrap(), vec!["x"]);
    }

    #[test]
    fn missing_file_is_not_an_error() {
        let mut tail = FileTail::from_start("/definitely/not/here.jsonl");
        assert!(tail.read_new_lines().unwrap().is_empty());
    }
}
