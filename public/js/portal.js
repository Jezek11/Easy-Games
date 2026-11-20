import { audio } from './audio.js';

const PORTAL_GAMES = [
  {
    id: 'buildroyale',
    title: 'BuildRoyale 3D',
    status: 'Hratelné',
    playable: true,
    bg: 'radial-gradient(circle at 75% 25%, rgba(0, 210, 255, 0.22) 0%, #181b21 58%, #0f1115 100%)',
    svg: `
      <svg viewBox="0 0 320 180" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="brRamp" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stop-color="#00d2ff" stop-opacity="0.14"/>
            <stop offset="100%" stop-color="#00d2ff" stop-opacity="0.62"/>
          </linearGradient>
          <linearGradient id="brWall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#272c37"/>
            <stop offset="100%" stop-color="#14171e"/>
          </linearGradient>
        </defs>
        <g stroke="#00d2ff" stroke-opacity="0.14" stroke-width="1">
          <line x1="0" y1="138" x2="320" y2="138"/>
          <line x1="0" y1="158" x2="320" y2="158"/>
          <line x1="80" y1="120" x2="30" y2="180"/>
          <line x1="160" y1="120" x2="160" y2="180"/>
          <line x1="240" y1="120" x2="290" y2="180"/>
        </g>
        <polygon points="56,142 138,66 190,66 108,142" fill="url(#brRamp)" stroke="#00d2ff" stroke-width="2"/>
        <rect x="192" y="44" width="76" height="98" rx="4" fill="url(#brWall)" stroke="rgba(255,255,255,0.22)" stroke-width="1.5"/>
        <rect x="218" y="72" width="24" height="24" rx="2" fill="#0f1115" stroke="#00d2ff" stroke-width="1.5"/>
        <circle cx="158" cy="56" r="14" stroke="#00d2ff" stroke-width="1.8" fill="none" stroke-opacity="0.8"/>
        <circle cx="158" cy="56" r="2.2" fill="#ffffff"/>
      </svg>
    `
  }
];

export function initPortal(gridEl, { onLaunchBuildRoyale }) {
  if (!gridEl) return;
  gridEl.innerHTML = '';

  for (const game of PORTAL_GAMES) {
    if (!game.playable) continue;
    const card = document.createElement('article');
    card.className = `game-card ${game.playable ? 'playable' : 'locked'}`;
    if (game.playable) {
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${game.title} — Hrát`);
    } else {
      card.tabIndex = -1;
      card.setAttribute('aria-disabled', 'true');
    }

    card.innerHTML = `
      <div class="card-art" style="background: ${game.bg}">
        ${game.svg}
        <span class="card-badge ${game.playable ? 'live' : 'soon'}">${game.status}</span>
        <div class="card-scrim"></div>
        <div class="card-footer">
          <div class="card-title">${game.title}</div>
          ${game.playable ? '<span class="card-play-btn">Hrát</span>' : ''}
        </div>
      </div>
    `;

    if (game.playable) {
      const handleActivate = () => {
        audio.playUiClick();
        onLaunchBuildRoyale?.();
      };
      card.addEventListener('click', handleActivate);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate();
        }
      });
    }

    gridEl.appendChild(card);
  }
}
