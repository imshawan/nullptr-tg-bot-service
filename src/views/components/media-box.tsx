export interface MediaBoxProps {
  isAudio: boolean;
  streamUrl: string;
  mimeType: string;
}

export function MediaBox({ isAudio, streamUrl, mimeType }: MediaBoxProps) {
  if (!isAudio) {
    return (
      <div class="viewport-box video-viewport">
        <video controls autoPlay playsInline preload="metadata">
          <source src={streamUrl} type={mimeType} />
          Your browser does not support video playback.
        </video>
      </div>
    );
  }

  return (
    <div class="viewport-box">
      <div class="audio-viewport-content">
        <div class="audio-artwork-badge">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        </div>

        <audio id="audioElement" preload="metadata" style="display:none;">
          <source src={streamUrl} type={mimeType} />
          Your browser does not support audio playback.
        </audio>

        <div class="audio-player-core">
          <button type="button" class="play-pause-btn" id="playBtn" aria-label="Play">
            <svg id="playSvg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            <svg id="pauseSvg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="display:none;">
              <rect x="6" y="4" width="4" height="16"></rect>
              <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
          </button>

          <div class="audio-track-details">
            <div class="scrub-wrapper">
              <input type="range" class="audio-slider" id="audioSlider" value="0" min="0" max="100" step="0.1" />
              <div class="time-row">
                <span id="currentTime">0:00</span>
                <span id="totalTime">--:--</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{
        __html: `
        (function initAudio() {
          const audio = document.getElementById('audioElement');
          const playBtn = document.getElementById('playBtn');
          const playSvg = document.getElementById('playSvg');
          const pauseSvg = document.getElementById('pauseSvg');
          const slider = document.getElementById('audioSlider');
          const curTime = document.getElementById('currentTime');
          const totTime = document.getElementById('totalTime');

          function formatTime(sec) {
            if (!sec || isNaN(sec)) return '0:00';
            const m = Math.floor(sec / 60);
            const s = Math.floor(sec % 60);
            return m + ':' + (s < 10 ? '0' : '') + s;
          }

          function setPlaying(isPlaying) {
            if (isPlaying) {
              playSvg.style.display = 'none';
              pauseSvg.style.display = 'block';
            } else {
              playSvg.style.display = 'block';
              pauseSvg.style.display = 'none';
            }
          }

          playBtn.addEventListener('click', () => {
            if (audio.paused) {
              audio.play();
            } else {
              audio.pause();
            }
          });

          audio.addEventListener('play', () => setPlaying(true));
          audio.addEventListener('pause', () => setPlaying(false));
          audio.addEventListener('ended', () => {
            setPlaying(false);
            slider.value = 0;
            curTime.textContent = '0:00';
          });

          audio.addEventListener('loadedmetadata', () => {
            totTime.textContent = formatTime(audio.duration);
          });

          audio.addEventListener('timeupdate', () => {
            if (!audio.duration) return;
            slider.value = (audio.currentTime / audio.duration) * 100;
            curTime.textContent = formatTime(audio.currentTime);
          });

          slider.addEventListener('input', () => {
            if (!audio.duration) return;
            audio.currentTime = (slider.value / 100) * audio.duration;
          });

          audio.play().catch(() => setPlaying(false));
        })();
        `
      }} />
    </div>
  );
}
