let audioCtx = null;
let musicNodes = [];
let musicPlaying = false;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "MUSIC_START") {
    startMusic(message.style);
  }
  if (message.type === "MUSIC_STOP") {
    stopMusic();
  }
});

function startMusic(style) {
  stopMusic();
  musicPlaying = true;
  audioCtx = new AudioContext();
  audioCtx.resume().then(() => {
    if (style === "lofi") playLofi();
    else if (style === "nature") playNature();
    else if (style === "focus") playDeepFocus();
  });
}

function stopMusic() {
  musicPlaying = false;
  musicNodes.forEach(n => { try { n.stop(); } catch (e) {} });
  musicNodes = [];
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
}

function playLofi() {
  if (!musicPlaying || !audioCtx) return;
  const drone = audioCtx.createOscillator();
  const droneGain = audioCtx.createGain();
  drone.type = "sine";
  drone.frequency.value = 110;
  droneGain.gain.value = 0.3;
  drone.connect(droneGain);
  droneGain.connect(audioCtx.destination);
  drone.start();
  musicNodes.push(drone);

  [164.81, 196, 246.94].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.value = 0.15;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime + i * 0.1);
    musicNodes.push(osc);
  });

  let beat = 0;
  const beatInterval = setInterval(() => {
    if (!musicPlaying || !audioCtx) { clearInterval(beatInterval); return; }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.value = beat % 4 === 0 ? 130 : 110;
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.4);
    beat++;
  }, 2000);
}

function playNature() {
  if (!musicPlaying || !audioCtx) return;
  const bufferSize = audioCtx.sampleRate * 3;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.08;
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 800;
  filter.Q.value = 0.5;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.value = 0.6;
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noise.start();
  musicNodes.push(noise);

  const birdInterval = setInterval(() => {
    if (!musicPlaying || !audioCtx) { clearInterval(birdInterval); return; }
    if (Math.random() > 0.4) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = [523, 659, 784, 880][Math.floor(Math.random() * 4)];
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.8);
  }, 1500);
}

function playDeepFocus() {
  if (!musicPlaying || !audioCtx) return;
  [40, 80, 120].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = i === 0 ? "sine" : "triangle";
    osc.frequency.value = freq;
    gain.gain.value = i === 0 ? 0.4 : 0.15;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    musicNodes.push(osc);
  });

  let pulse = 0;
  const pulseInterval = setInterval(() => {
    if (!musicPlaying || !audioCtx) { clearInterval(pulseInterval); return; }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = pulse % 2 === 0 ? 528 : 432;
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + 1);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 3.5);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 4);
    pulse++;
  }, 4000);
}