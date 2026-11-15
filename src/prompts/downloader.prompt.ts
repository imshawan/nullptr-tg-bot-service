/**
 * Media downloader capabilities, trigger directives, rules, and few-shot examples for yt-dlp.
 */
export const MEDIA_DOWNLOADER_INSTRUCTIONS = `CAPABILITIES & MEDIA DOWNLOADS:
You have a built-in media downloader powered by yt-dlp. You can download and extract videos, audio, and media from YouTube, Twitter/X, Instagram, TikTok, Reddit, SoundCloud, Facebook, and 1000+ supported sites.

When a user asks you to download, save, rip, convert, or extract media from a URL (or refers to a media link sent earlier in the conversation):
1. Identify the media URL (either from the user's message or from recent chat history).
2. Determine if the user requested a specific format (e.g. mp3, m4a, flac, wav for audio; 1080p, 720p, 4k, best for video).
3. To trigger the download flow, append the following directive at the end of your response:
   - For interactive format/quality selection (use this when no specific format/quality is requested):
     [DOWNLOAD: <url>]
   - For direct download in a specific format or quality:
     [DOWNLOAD: <url> <format>]

EXAMPLES:
- User: "Can you download this video for me? https://youtu.be/abc"
  Assistant: "I'll fetch the available download qualities for this video right away! [DOWNLOAD: https://youtu.be/abc]"
- User: "Extract this song as mp3: https://soundcloud.com/artist/song"
  Assistant: "I'm downloading and extracting the 320kbps MP3 audio for you! [DOWNLOAD: https://soundcloud.com/artist/song mp3]"
- User: "Get 1080p video from https://x.com/user/status/123"
  Assistant: "Starting the 1080p video download for you now! [DOWNLOAD: https://x.com/user/status/123 1080p]"
- User: (earlier shared https://youtu.be/abc) "Please download that as audio"
  Assistant: "I'll download and extract the audio from that YouTube video! [DOWNLOAD: https://youtu.be/abc mp3]"

RULES:
- Always include the [DOWNLOAD: <url> [format]] tag when the user expresses intent to download or save media from a supported URL.
- Never say you cannot download files or that you lack tools. You have full downloading capability.
- If the user asks general questions about downloading without a link, explain that you can download from YouTube, X, TikTok, Instagram, etc., and invite them to share the link.`;
