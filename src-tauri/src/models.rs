use serde::{Deserialize, Serialize};

pub const FAVORITES_PLAYLIST_ID: &str = "favorites";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Track {
    pub id: String,
    pub path: String,
    pub title: String,
    pub artist: Option<String>,
    pub duration: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub category: PlaylistCategory,
    pub id_tracks: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaylistCategory {
    #[serde(rename = "EP")]
    Ep,
    #[serde(rename = "Альбом")]
    Album,
    #[serde(rename = "Плейлист")]
    Playlist,
}

impl Default for PlaylistCategory {
    fn default() -> Self {
        Self::Playlist
    }
}

impl PlaylistCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ep => "EP",
            Self::Album => "Альбом",
            Self::Playlist => "Плейлист",
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CoverKind {
    Track,
    Playlist,
}

impl CoverKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Track => "track",
            Self::Playlist => "playlist",
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Cover {
    pub id: String,
    pub kind: CoverKind,
    pub entity_id: String,
    pub path_file: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecentItemKind {
    Track,
    Playlist,
}

impl RecentItemKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Track => "track",
            Self::Playlist => "playlist",
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct RecentItem {
    pub kind: RecentItemKind,
    pub entity_id: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(tag = "source", content = "path", rename_all = "snake_case")]
pub enum RecentCover {
    Asset(String),
    File(String),
}

#[derive(Serialize, Debug, Clone)]
pub struct RecentEntry {
    pub kind: RecentItemKind,
    pub entity_id: String,
    pub title: String,
    pub subtitle: String,
    pub cover: RecentCover,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PlayerConfig {
    pub current_track_id: Option<String>,
    pub position_secs: f64,
    pub volume: f64,
    pub is_playing: bool,
}

impl Default for PlayerConfig {
    fn default() -> Self {
        Self {
            current_track_id: None,
            position_secs: 0.0,
            volume: 0.7,
            is_playing: false,
        }
    }
}
