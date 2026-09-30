export function audioPeaks(buffer, count = 180) {
  const peaks = new Float32Array(count);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < count; i++) {
      const start = Math.floor(i * samples.length / count);
      const end = Math.floor((i + 1) * samples.length / count);
      let energy = 0;
      for (let j = start; j < end; j++) energy += samples[j] * samples[j];
      const peak = Math.sqrt(energy / Math.max(1, end - start));
      peaks[i] = Math.max(peaks[i], peak);
    }
  }
  return Array.from(peaks);
}

export function voiceTime(seconds, precise = false) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}${precise ? `.${Math.floor(value % 1 * 10)}` : ''}`;
}

const icon = playing => playing
  ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="4"/></svg>'
  : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
let signature;
let dispose = () => {};

export function renderVoicePlayer(project, busy, selectVersion) {
  const audio = project?.audio || { takes: [] };
  const takes = audio.takes || [];
  const take = takes.find(item => item.id === audio.selectedId);
  const key = JSON.stringify([project?.id, audio.selectedId, takes, busy]);
  if (key === signature) return;
  signature = key;
  dispose();
  const versionRoot = document.querySelector('#voice-takes');
  const timelineRoot = document.querySelector('#voice-timeline');
  const switchRoot = document.querySelector('#voice-version-switch');
  versionRoot.replaceChildren();
  timelineRoot.replaceChildren();
  switchRoot.replaceChildren();
  const switcher = el('details', 'voice-version-menu');
  const summary = el('summary', '', '更换版本');
  const menu = el('div', 'voice-version-options');
  takes.forEach((item, i) => {
    const option = el('button', '', `版本 ${String(i + 1).padStart(2, '0')} · ${voiceTime(item.durationMs / 1000)}${item.id === take?.id ? ' · 当前使用' : ''}`);
    option.type = 'button';
    option.disabled = busy || item.id === take?.id;
    option.onclick = () => selectVersion(item.id);
    menu.append(option);
  });
  switcher.append(summary, menu);
  if (takes.length > 1) switchRoot.append(switcher);
  if (!take?.url) {
    versionRoot.append(el('p', 'voice-player-empty', '展开“生成新版本”，开始制作口播。'));
    timelineRoot.append(el('p', 'voice-player-empty', '生成并识别配音后，在这里试听和调整台词。'));
    dispose = () => {};
    return;
  }
  const player = new Audio(take.url);
  player.preload = 'metadata';
  const abort = new AbortController();
  let disposed = false;
  let frame = 0;
  let duration = take.durationMs / 1000 || 0;
  let peaks = null;
  const views = [];
  const cards = [];
  const report = message => { document.querySelector('#voice-error').textContent = message; };
  function sync() {
    const seconds = player.currentTime;
    const percent = duration > 0 ? Math.min(100, seconds / duration * 100) : 0;
    for (const view of views) {
      view.button.innerHTML = icon(!player.paused);
      view.button.setAttribute('aria-label', player.paused ? '播放配音' : '暂停配音');
      view.button.setAttribute('aria-pressed', String(!player.paused));
      view.track.style.setProperty('--progress', `${percent}%`);
      view.track.setAttribute('aria-valuemax', String(duration));
      view.track.setAttribute('aria-valuenow', seconds.toFixed(1));
      view.track.setAttribute('aria-valuetext', `${voiceTime(seconds)} / ${voiceTime(duration)}`);
      view.time.textContent = view.detailed ? voiceTime(seconds, true) : `${voiceTime(seconds)} / ${voiceTime(duration)}`;
      if (view.end) view.end.textContent = voiceTime(duration);
      const played = Math.floor(percent / 100 * 180);
      if (view.played !== played) {
        view.svg.querySelectorAll('line').forEach((line, index) => {
          line.style.stroke = index < played ? 'var(--voice-blue)' : '';
        });
        view.played = played;
      }
    }
    cards.forEach(({ row, start, end, seek }) => {
      const active = seconds >= Number(start.value) && seconds < Number(end.value);
      if (active && row.dataset.active !== 'true' && !row.parentElement.contains(document.activeElement)) {
        const strip = row.parentElement;
        const left = row.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
        if (left < strip.scrollLeft || left + row.offsetWidth > strip.scrollLeft + strip.clientWidth) {
          strip.scrollLeft = left;
        }
      }
      row.dataset.active = String(active);
      seek.setAttribute('aria-pressed', String(active));
    });
  }
  const seekTo = value => {
    player.currentTime = Math.max(0, Math.min(duration, value));
    sync();
  };
  function draw(view) {
    const svg = view.svg;
    svg.replaceChildren();
    if (!peaks) return;
    const max = Math.max(...peaks, 0.01);
    peaks.forEach((peak, i) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const half = Math.max(1, (peak / max) ** 1.5 * 26);
      line.setAttribute('x1', String(i * 5 + 2));
      line.setAttribute('x2', String(i * 5 + 2));
      line.setAttribute('y1', String(30 - half));
      line.setAttribute('y2', String(30 + half));
      svg.append(line);
    });
    view.loading.remove();
    view.played = undefined;
    sync();
  }
  function buildView(root, detailed) {
    const row = el('div', `voice-player-row${detailed ? ' voice-player-detailed' : ''}`);
    const button = el('button', 'voice-play');
    button.type = 'button';
    button.innerHTML = icon(false);
    button.onclick = async () => {
      try { if (player.paused) await player.play(); else player.pause(); }
      catch { report('音频无法播放，请检查配音文件是否可用。'); }
    };
    const body = el('div', 'voice-player-body');
    const track = el('div', 'voice-wave-track');
    track.tabIndex = 0;
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-label', detailed ? '台词对齐播放位置' : '配音播放位置');
    track.setAttribute('aria-valuemin', '0');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 900 60');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('voice-wave-svg');
    const loading = el('span', 'voice-wave-loading', '正在读取音频波形…');
    track.append(svg, loading);
    const time = el('span', detailed ? 'voice-playhead-label' : 'voice-elapsed');
    let end;
    if (detailed) {
      const cursor = el('div', 'voice-playhead');
      cursor.append(time);
      track.append(cursor);
      const ruler = el('div', 'voice-time-ruler');
      end = el('span', '', voiceTime(duration));
      ruler.append(el('span', '', '0:00'), el('span', '', voiceTime(duration / 2)), end);
      body.append(track, ruler);
    } else body.append(track, time);
    const pointerSeek = event => {
      const rect = track.getBoundingClientRect();
      seekTo((event.clientX - rect.left) / rect.width * duration);
    };
    track.onpointerdown = event => {
      if (event.button !== 0) return;
      track.setPointerCapture(event.pointerId);
      pointerSeek(event);
    };
    track.onpointermove = event => { if (track.hasPointerCapture(event.pointerId)) pointerSeek(event); };
    track.onpointerup = event => { if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId); };
    track.onkeydown = event => {
      const offsets = { ArrowLeft: -5, ArrowRight: 5, Home: -duration, End: duration };
      if (event.key in offsets) { event.preventDefault(); seekTo(player.currentTime + offsets[event.key]); }
      if (event.key === ' ') { event.preventDefault(); button.click(); }
    };
    row.append(button, body);
    root.append(row);
    const view = { button, track, svg, loading, time, detailed, end };
    views.push(view);
  }
  buildView(versionRoot, false);
  if (take.timeline?.length) {
    buildView(timelineRoot, true);
    const segments = el('div', 'voice-segment-strip');
    take.timeline.forEach((segment, index) => {
      const row = el('article', 'timing-row');
      row.dataset.shotId = segment.shotId;
      const seek = el('button', 'voice-segment-seek');
      seek.type = 'button';
      seek.append(el('span', 'timing-row-text', segment.text));
      seek.title = segment.text;
      seek.setAttribute('aria-label', `试听第 ${index + 1} 段：${segment.text}`);
      row.append(seek);
      const range = el('div', 'voice-segment-range');
      const inputs = {};
      for (const key of ['start', 'end']) {
        const input = el('input', '');
        input.type = 'number'; input.step = '0.01'; input.min = '0'; input.max = String(duration);
        input.value = String(segment[key] / 1000); input.dataset.timeKey = key;
        input.setAttribute('aria-label', `第 ${index + 1} 段${key === 'start' ? '起点' : '终点'}（秒）`);
        input.disabled = busy;
        inputs[key] = input;
        if (key === 'end') range.append(el('span', '', '–'));
        range.append(input);
      }
      range.append(el('span', 'voice-segment-unit', '秒'));
      range.hidden = true;
      const rangeToggle = el('button', 'voice-range-toggle');
      rangeToggle.type = 'button';
      rangeToggle.setAttribute('aria-label', `调整第 ${index + 1} 段时间`);
      rangeToggle.setAttribute('aria-expanded', 'false');
      const updateRange = () => { rangeToggle.textContent = `${voiceTime(inputs.start.value)} – ${voiceTime(inputs.end.value)}`; };
      updateRange();
      inputs.start.oninput = inputs.end.oninput = updateRange;
      rangeToggle.onclick = () => {
        range.hidden = !range.hidden;
        rangeToggle.setAttribute('aria-expanded', String(!range.hidden));
      };
      seek.onclick = () => seekTo(Number(inputs.start.value));
      row.append(rangeToggle, range); segments.append(row);
      cards.push({ row, seek, ...inputs });
    });
    timelineRoot.append(segments);
  } else timelineRoot.append(el('p', 'voice-player-empty', '识别后，台词片段会显示在这里。'));
  function tick() { sync(); if (!player.paused) frame = requestAnimationFrame(tick); }
  player.onplay = () => { cancelAnimationFrame(frame); tick(); };
  player.onpause = () => { cancelAnimationFrame(frame); sync(); };
  player.ontimeupdate = sync;
  player.onloadedmetadata = () => { if (Number.isFinite(player.duration)) duration = player.duration; sync(); };
  player.onerror = () => report('配音文件无法加载，请检查本地音频文件。');
  sync();
  dispose = () => { disposed = true; abort.abort(); cancelAnimationFrame(frame); player.pause(); player.removeAttribute('src'); player.load(); };
  (async () => {
    let context;
    try {
      const response = await fetch(take.url, { signal: abort.signal });
      if (!response.ok) throw new Error('audio download failed');
      const data = await response.arrayBuffer();
      if (disposed) return;
      context = new AudioContext();
      const buffer = await context.decodeAudioData(data);
      if (disposed) return;
      peaks = audioPeaks(buffer);
      views.forEach(draw);
    } catch (error) {
      if (!disposed) views.forEach(view => { view.loading.textContent = '波形读取失败，仍可播放或定位'; });
    } finally { if (context) await context.close(); }
  })();
}
