document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const fileInput = document.getElementById('file-input');
    const artwork = document.getElementById('artwork');
    const title = document.getElementById('title');
    const artist = document.getElementById('artist');
    const titleContainer = document.querySelector('.title-container');
    const artistContainer = document.querySelector('.artist-container');
    const currentTimeEl = document.getElementById('current-time');
    const totalTimeEl = document.getElementById('total-time');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const speedSlider = document.getElementById('speed-slider');
    const speedValue = document.getElementById('speed-value');
    const toggleSpeedBtn = document.getElementById('toggle-speed-btn');
    const speedControls = document.getElementById('speed-controls');
    const repeatAllBtn = document.getElementById('repeat-all-btn');
    const repeatOneBtn = document.getElementById('repeat-one-btn');
    const speedDecreaseBtn = document.getElementById('speed-decrease-btn');
    const speedIncreaseBtn = document.getElementById('speed-increase-btn');
    const progressContainer = document.querySelector('.progress-container');

    // --- SVG Icons ---
    const playIconSVG = `<svg class="play-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path d="M187.2 100.9C174.8 94.1 159.8 94.4 147.6 101.6C135.4 108.8 128 121.9 128 136L128 504C128 518.1 135.5 531.2 147.6 538.4C159.7 545.6 174.8 545.9 187.2 539.1L523.2 355.1C536 348.1 544 334.6 544 320C544 305.4 536 291.9 523.2 284.9L187.2 100.9z"/></svg>`;
    const pauseIconSVG = `<svg class="pause-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path d="M176 96C149.5 96 128 117.5 128 144L128 496C128 522.5 149.5 544 176 544L240 544C266.5 544 288 522.5 288 496L288 144C288 117.5 266.5 96 240 96L176 96zM400 96C373.5 96 352 117.5 352 144L352 496C352 522.5 373.5 544 400 544L464 544C490.5 544 512 522.5 512 496L512 144C512 117.5 490.5 96 464 96L400 96z"/></svg>`;

    // --- Canvas & drawing ---
    const canvas = document.getElementById('waveCanvas');
    const ctx = canvas.getContext('2d');

    // --- Audio (Web Audio API) ---
    let audioContext;
    let sourceNode = null;
    let audioBuffer = null;
    let startTime = 0; // audioContext time when started
    let pausePosition = 0; // playback position in seconds when paused

    // --- Player State ---
    let playlist = [];
    let currentTrackIndex = 0;
    let isPlaying = false;
    let isShuffle = false;
    let repeatMode = 0; // 0 = none, 1 = repeat all, 2 = repeat one
    let shuffledIndices = [];
    let currentShuffleIndex = 0;

    // --- Canvas animation state ---
    let isInteractingWithCanvas = false;
    let progress = 0;
    let phaseShift = 0;
    const waveFrequency = 0.399;
    let targetAmplitude = 4;
    let currentAmplitude = 4;
    const style = getComputedStyle(document.documentElement);
    const activeTrackHeight = parseFloat(style.getPropertyValue('--active-track-height')) || 2;
    const inactiveTrackHeight = parseFloat(style.getPropertyValue('--inactive-track-height')) || 4;
    const thumbWidth = parseFloat(style.getPropertyValue('--thumb-width')) || 5;
    const thumbHeight = parseFloat(style.getPropertyValue('--thumb-height')) || 15;
    const activeTrackColor = style.getPropertyValue('--accent-color') || '#89b4fa';
    const inactiveTrackColor = 'rgba(255, 255, 255, 0.18)';
    const thumbColor = style.getPropertyValue('--primary-text') || '#e0e0e0';

    // Control requestAnimationFrame loop
    let animationStarted = false;

    // --- Utilities ---
    function initAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '0:00';
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
    }

    // Ensure canvas is sized correctly and scaled once
    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        // reset transform and scale correctly (avoid accumulating scales)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Start single animation loop
    function startAnimationLoop() {
        if (animationStarted) return;
        animationStarted = true;
        const loop = () => {
            updateAndDraw();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    // --- Scrolling text (marquee) ---
    function checkTextOverflow(element, container) {
        element.classList.remove('scrolling');
        element.style.removeProperty('--scroll-amount');

        // small timeout to ensure layout is stable
        setTimeout(() => {
            const isOverflowing = element.scrollWidth > container.clientWidth + 2; // tolerance
            if (isOverflowing) {
                element.classList.add('scrolling');
                const scrollAmount = container.clientWidth - element.scrollWidth;
                element.style.setProperty('--scroll-amount', `${scrollAmount}px`);
            }
        }, 50);
    }

    // --- File handling & metadata ---
    fileInput.addEventListener('change', (e) => {
        initAudioContext();
        const newFiles = Array.from(e.target.files || []);
        if (newFiles.length === 0) return;

        const wasEmpty = playlist.length === 0;
        playlist = playlist.concat(newFiles);

        if (isShuffle) {
            generateShuffledPlaylist();
        }

        if (wasEmpty) {
            currentTrackIndex = 0;
            loadTrack(currentTrackIndex, false);
        }
    });

    function loadTrack(index, autoplay = false) {
        // stop any currently playing source
        stopSource();
        const file = playlist[index];
        if (!file) return;

        // set blurred background placeholder while decoding
        const playerUI = document.querySelector('.music-player');
        playerUI.style.setProperty('--background-image', 'url("https://via.placeholder.com/380")');

        // decode audio
        const reader = new FileReader();
        reader.onload = (ev) => {
            initAudioContext();
            audioContext.decodeAudioData(ev.target.result).then((buffer) => {
                audioBuffer = buffer;
                pausePosition = 0;
                progress = 0;
                totalTimeEl.textContent = formatTime(buffer.duration);
                currentTimeEl.textContent = '0:00';
                if (autoplay) playTrack();
            }).catch((err) => console.error('Error decoding audio data:', err));
        };
        reader.readAsArrayBuffer(file);

        // read tags for artwork, title, artist
        window.jsmediatags.read(file, {
            onSuccess: function (tag) {
                const tags = tag.tags || {};
                title.textContent = tags.title || file.name.replace(/\.[^/.]+$/, "");
                artist.textContent = tags.artist || "Unknown Artist";

                checkTextOverflow(title, titleContainer);
                checkTextOverflow(artist, artistContainer);

                if (tags.picture) {
                    const {
                        data,
                        format
                    } = tags.picture;
                    let base64String = "";
                    for (let i = 0; i < data.length; i++) {
                        base64String += String.fromCharCode(data[i]);
                    }
                    const imageUri = `data:${format};base64,${window.btoa(base64String)}`;
                    artwork.src = imageUri;
                    playerUI.style.setProperty('--background-image', `url(${imageUri})`);
                } else {
                    artwork.src = "https://via.placeholder.com/80";
                }
            },
            onError: function (error) {
                // fallback to file name
                title.textContent = file.name.replace(/\.[^/.]+$/, "");
                artist.textContent = "Unknown Artist";
                artwork.src = "https://via.placeholder.com/80";
                checkTextOverflow(title, titleContainer);
                checkTextOverflow(artist, artistContainer);
            }
        });
    }

    // --- Playback control helpers ---
    function createSourceNode(playbackRate = 1) {
        if (!audioContext || !audioBuffer) return null;
        const src = audioContext.createBufferSource();
        src.buffer = audioBuffer;
        src.playbackRate.value = playbackRate;
        src.connect(audioContext.destination);
        src.onended = onSourceEnded;
        return src;
    }

    function playTrack() {
        if (!audioBuffer) return;
        initAudioContext();

        // if already playing, do nothing
        if (isPlaying && sourceNode) return;

        // create and start a new source from pausePosition
        const rate = parseFloat(speedSlider.value);
        sourceNode = createSourceNode(rate);
        if (!sourceNode) return;

        // record start time and start playback from pausePosition
        startTime = audioContext.currentTime;
        try {
            sourceNode.start(0, pausePosition);
        } catch (e) {
            // some browsers may throw if start offset is near end — clamp it
            const safeOffset = Math.max(0, Math.min(pausePosition, audioBuffer.duration - 0.001));
            sourceNode.start(0, safeOffset);
            startTime = audioContext.currentTime - (pausePosition - safeOffset) / (rate || 1);
        }

        isPlaying = true;
        playPauseBtn.innerHTML = pauseIconSVG;

        // ensure animation loop is running
        startAnimationLoop();
    }

    function pauseTrack() {
        if (!audioContext) return;
        if (sourceNode) {
            // compute the accurate position considering playbackRate
            const rate = sourceNode.playbackRate ? sourceNode.playbackRate.value : 1;
            const elapsed = audioContext.currentTime - startTime;
            pausePosition = pausePosition + elapsed * rate;

            // stop and clean
            sourceNode.onended = null;
            try {
                sourceNode.stop();
            } catch (e) { /* ignore */ }
            sourceNode.disconnect && sourceNode.disconnect();
            sourceNode = null;
        }
        isPlaying = false;
        playPauseBtn.innerHTML = playIconSVG;
    }

    function stopSource() {
        if (sourceNode) {
            try {
                sourceNode.stop();
            } catch (e) { /* ignore */ }
            sourceNode.onended = null;
            sourceNode.disconnect && sourceNode.disconnect();
            sourceNode = null;
        }
        isPlaying = false;
        playPauseBtn.innerHTML = playIconSVG;
    }

    function onSourceEnded(ev) {
        // only trigger if ended naturally (not via stop)
        // reset pausePosition to 0 for next play
        pausePosition = 0;
        progress = 0;
        currentTimeEl.textContent = formatTime(0);

        if (repeatMode === 2) {
            // ✅ repeat-one: restart cleanly from the beginning
            stopSource();          // fully stop current node
            pausePosition = 0;     // reset position
            playTrack();           // reload & play from 0
            return;
        }


        if (isShuffle) {
            nextTrack(true);
            return;
        }

        if (currentTrackIndex < playlist.length - 1) {
            // move to next track
            nextTrack(true);
            return;
        }

        if (repeatMode === 1 && playlist.length > 0) {
            // repeat-all
            currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
            loadTrack(currentTrackIndex, true);
            return;
        }

        // otherwise stop and show play icon
        isPlaying = false;
        playPauseBtn.innerHTML = playIconSVG;
    }

    function playPauseToggle() {
        if (isPlaying) pauseTrack();
        else playTrack();
    }

    // --- Shuffle / Next / Prev logic ---
    function generateShuffledPlaylist() {
        shuffledIndices = Array.from({
            length: playlist.length
        }, (_, i) => i);
        for (let i = shuffledIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
        }
        // try to keep current track at the start
        const pos = shuffledIndices.indexOf(currentTrackIndex);
        if (pos > 0) {
            [shuffledIndices[0], shuffledIndices[pos]] = [shuffledIndices[pos], shuffledIndices[0]];
        }
        currentShuffleIndex = 0;
    }

    function nextTrack(autoplay = false) {
        stopSource();
        pausePosition = 0;

        if (isShuffle && playlist.length > 1) {
            // advance shuffle index but ensure next index isn't the same as current
            currentShuffleIndex = (currentShuffleIndex + 1) % shuffledIndices.length;
            // if it points to current, move again (only possible if length>1)
            if (shuffledIndices[currentShuffleIndex] === currentTrackIndex) {
                currentShuffleIndex = (currentShuffleIndex + 1) % shuffledIndices.length;
            }
            currentTrackIndex = shuffledIndices[currentShuffleIndex];
        } else if (!isShuffle) {
            currentTrackIndex = (currentTrackIndex + 1) % playlist.length;
        }

        loadTrack(currentTrackIndex, autoplay);
    }

    function prevTrack() {
        const wasPlaying = isPlaying;
        stopSource();
        pausePosition = 0;

        if (isShuffle && playlist.length > 1) {
            currentShuffleIndex = (currentShuffleIndex - 1 + shuffledIndices.length) % shuffledIndices.length;
            if (shuffledIndices[currentShuffleIndex] === currentTrackIndex) {
                currentShuffleIndex = (currentShuffleIndex - 1 + shuffledIndices.length) % shuffledIndices.length;
            }
            currentTrackIndex = shuffledIndices[currentShuffleIndex];
        } else {
            currentTrackIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
        }

        loadTrack(currentTrackIndex, wasPlaying);
    }

    // --- UI Event listeners ---
    playPauseBtn.addEventListener('click', playPauseToggle);
    nextBtn.addEventListener('click', () => nextTrack(isPlaying));
    prevBtn.addEventListener('click', prevTrack);

    shuffleBtn.addEventListener('click', () => {
        isShuffle = !isShuffle;
        shuffleBtn.classList.toggle('active', isShuffle);
        if (isShuffle && playlist.length > 0) generateShuffledPlaylist();
    });

    repeatAllBtn.addEventListener('click', () => {
        // toggle between none and repeat-all
        repeatMode = (repeatMode === 1) ? 0 : 1;
        updateRepeatButtons();
    });

    repeatOneBtn.addEventListener('click', () => {
        repeatMode = (repeatMode === 2) ? 0 : 2;
        updateRepeatButtons();
    });

    function updateRepeatButtons() {
        repeatAllBtn.classList.remove('active');
        repeatOneBtn.classList.remove('active');
        if (repeatMode === 1) repeatAllBtn.classList.add('active');
        else if (repeatMode === 2) repeatOneBtn.classList.add('active');
    }

    // --- Canvas seeking interaction ---
    let isDraggingProgressBar = false;

    function computePlaybackPositionFromCanvasEvent(e) {
        if (!audioBuffer) return 0;
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const offsetX = clientX - rect.left;
        const newProgress = Math.max(0, Math.min(1, offsetX / rect.width));
        return newProgress * audioBuffer.duration;
    }

    function handleSeek(e) {
        if (!audioBuffer) return;
        const newPos = computePlaybackPositionFromCanvasEvent(e);
        // set pausePosition; if playing, recreate source from new position
        pausePosition = newPos;
        progress = audioBuffer.duration ? (pausePosition / audioBuffer.duration) : 0;
        currentTimeEl.textContent = formatTime(pausePosition);

        if (isPlaying) {
            // restart playback from new position
            if (sourceNode) {
                try {
                    sourceNode.stop();
                } catch (err) { /* ignore */ }
                sourceNode.onended = null;
                sourceNode.disconnect && sourceNode.disconnect();
                sourceNode = null;
            }
            playTrack();
        }
    }

    progressContainer.addEventListener('mousedown', (e) => {
        isDraggingProgressBar = true;
        isInteractingWithCanvas = true;
        handleSeek(e);
    });

    document.addEventListener('mousemove', (e) => {
        if (isDraggingProgressBar) handleSeek(e);
    });

    document.addEventListener('mouseup', () => {
        isDraggingProgressBar = false;
        isInteractingWithCanvas = false;
    });

    progressContainer.addEventListener('touchstart', (e) => {
        isDraggingProgressBar = true;
        isInteractingWithCanvas = true;
        handleSeek(e);
    }, {
        passive: true
    });

    document.addEventListener('touchmove', (e) => {
        if (isDraggingProgressBar) handleSeek(e);
    }, {
        passive: true
    });
    document.addEventListener('touchend', () => {
        isDraggingProgressBar = false;
        isInteractingWithCanvas = false;
    });

    // --- Speed controls ---
    // [START] JAVASCRIPT MODIFICATION (new function)
    function updateSpeedSliderFill(slider) {
        const min = slider.min;
        const max = slider.max;
        const val = slider.value;
        const percentage = ((val - min) / (max - min)) * 100;
        slider.style.setProperty('--fill-percent', `${percentage}%`);
    }
    // [END] JAVASCRIPT MODIFICATION

    function setPlaybackSpeed(speed) {
        const minSpeed = parseFloat(speedSlider.min);
        const maxSpeed = parseFloat(speedSlider.max);
        speed = Math.max(minSpeed, Math.min(maxSpeed, speed));

        speedSlider.value = speed;
        speedValue.textContent = `${parseFloat(speed).toFixed(2)}x`;

        if (sourceNode) {
            // To change playback rate during playback we adjust the existing node if possible,
            // otherwise restart from current logical position
            try {
                sourceNode.playbackRate.value = speed;
            } catch (e) {
                // recreate source to apply rate change (preserve position)
                const wasPlaying = isPlaying;
                if (wasPlaying) {
                    if (sourceNode) {
                        try {
                            sourceNode.stop();
                        } catch (e) { }
                    }
                    playTrack();
                }
            }
        }
    }

    toggleSpeedBtn.addEventListener('click', () => {
        speedControls.classList.toggle('expanded');
        toggleSpeedBtn.classList.toggle('active');
    });

    // [START] JAVASCRIPT MODIFICATION (updated event listener)
    speedSlider.addEventListener('input', (e) => {
        setPlaybackSpeed(parseFloat(e.target.value));
        updateSpeedSliderFill(e.target);
    });
    // [END] JAVASCRIPT MODIFICATION

    speedDecreaseBtn.addEventListener('click', () => {
        const newSpeed = parseFloat(speedSlider.value) - 0.05;
        setPlaybackSpeed(newSpeed);
        updateSpeedSliderFill(speedSlider);
    });
    speedIncreaseBtn.addEventListener('click', () => {
        const newSpeed = parseFloat(speedSlider.value) + 0.05;
        setPlaybackSpeed(newSpeed);
        updateSpeedSliderFill(speedSlider);
    });

    // --- Drawing / animation update ---
    function updateAndDraw() {
        // update playback position
        if (isPlaying && audioBuffer && audioContext && sourceNode) {
            const rate = sourceNode.playbackRate ? sourceNode.playbackRate.value : 1;
            const elapsed = audioContext.currentTime - startTime; // realtime
            const logicalPosition = pausePosition + elapsed * rate;
            // clamp
            const clamped = Math.max(0, Math.min(audioBuffer.duration, logicalPosition));
            progress = audioBuffer.duration ? (clamped / audioBuffer.duration) : 0;
            currentTimeEl.textContent = formatTime(clamped);
        }

        // draw canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const centerY = height / 2;

        // amplitude behaviour
        targetAmplitude = (isInteractingWithCanvas || !isPlaying) ? 0 : 2;
        currentAmplitude += (targetAmplitude - currentAmplitude) * 0.08;

        const activeTrackEnd = width * progress;

        // inactive track
        ctx.beginPath();
        ctx.moveTo(activeTrackEnd, centerY);
        ctx.lineTo(width, centerY);
        ctx.lineWidth = inactiveTrackHeight;
        ctx.strokeStyle = inactiveTrackColor;
        ctx.lineCap = 'round';
        ctx.stroke();

        // active track (wave)
        ctx.beginPath();
        ctx.lineWidth = activeTrackHeight;
        ctx.strokeStyle = activeTrackColor;
        ctx.lineCap = 'round';

        if (currentAmplitude > 0.12 && activeTrackEnd > 0) {
            for (let x = 0; x <= activeTrackEnd; x += 2) {
                const waveY = centerY + currentAmplitude * Math.sin(x * waveFrequency - phaseShift);
                if (x === 0) ctx.moveTo(x, waveY);
                else ctx.lineTo(x, waveY);
            }
        } else if (activeTrackEnd > 0) {
            ctx.moveTo(0, centerY);
            ctx.lineTo(activeTrackEnd, centerY);
        }
        ctx.stroke();

        // thumb
        const thumbX = activeTrackEnd;
        ctx.beginPath();
        ctx.strokeStyle = thumbColor;
        ctx.lineWidth = thumbWidth;
        ctx.lineCap = 'round';
        ctx.moveTo(thumbX, centerY - thumbHeight / 2);
        ctx.lineTo(thumbX, centerY + thumbHeight / 2);
        ctx.stroke();

        // phase movement
        if (isPlaying) phaseShift -= 0.04;
    }

    // --- Canvas resize handling ---
    window.addEventListener('resize', () => {
        resizeCanvas();
    });
    resizeCanvas();
    startAnimationLoop();

    // --- Initial UI state ---
    updateRepeatButtons();

    // [START] JAVASCRIPT MODIFICATION (set initial slider fill)
    updateSpeedSliderFill(speedSlider);
    // [END] JAVASCRIPT MODIFICATION

    // expose a small API for testing/debugging (optional)
    window.__PLAYER = {
        play: playTrack,
        pause: pauseTrack,
        load: loadTrack,
        next: nextTrack,
        prev: prevTrack,
        getState: () => ({
            isPlaying,
            currentTrackIndex,
            playlistLength: playlist.length
        })
    };
});
