import { audio } from './audio.js';
import { t } from './i18n.js';

const PORTAL_GAMES = [
  {
    id: 'buildroyale',
    title: 'SkyBuild',
    statusKey: 'portal_game_status_live',
    taglineKey: 'portal_game_tagline',
    playable: true,
    bg: 'radial-gradient(circle at 72% 28%, rgba(0, 210, 255, 0.24) 0%, #141a24 52%, #0b0e14 100%)',
    svg: `
      <svg viewBox="0 0 320 180" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="sbGlow" cx="68%" cy="32%" r="60%">
            <stop offset="0%" stop-color="#00d2ff" stop-opacity="0.34"/>
            <stop offset="55%" stop-color="#00d2ff" stop-opacity="0.06"/>
            <stop offset="100%" stop-color="#00d2ff" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="sbHorizon" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#00d2ff" stop-opacity="0"/>
            <stop offset="100%" stop-color="#00d2ff" stop-opacity="0.16"/>
          </linearGradient>
          <linearGradient id="sbRampTop" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stop-color="#0891b2" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.88"/>
          </linearGradient>
          <linearGradient id="sbWallFront" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#232c3b"/>
            <stop offset="100%" stop-color="#121721"/>
          </linearGradient>
          <linearGradient id="sbWallSide" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#161c26"/>
            <stop offset="100%" stop-color="#0c1017"/>
          </linearGradient>
        </defs>

        <!-- Atmospheric glow -->
        <rect width="320" height="180" fill="url(#sbGlow)"/>
        <rect x="0" y="96" width="320" height="30" fill="url(#sbHorizon)"/>

        <!-- Clean perspective arena floor grid -->
        <g stroke="#38bdf8" stroke-opacity="0.16" stroke-width="1">
          <line x1="0" y1="126" x2="320" y2="126"/>
          <line x1="0" y1="142" x2="320" y2="142"/>
          <line x1="0" y1="164" x2="320" y2="164"/>
          <line x1="160" y1="126" x2="160" y2="180"/>
          <line x1="115" y1="126" x2="55" y2="180"/>
          <line x1="205" y1="126" x2="265" y2="180"/>
          <line x1="70" y1="126" x2="-30" y2="180"/>
          <line x1="250" y1="126" x2="350" y2="180"/>
        </g>

        <!-- Isometric 3D Edited Wall (front + side depth + glowing window) -->
        <polygon points="178,42 246,42 246,126 178,126" fill="url(#sbWallFront)" stroke="#38bdf8" stroke-opacity="0.55" stroke-width="1.4"/>
        <polygon points="246,42 260,50 260,132 246,126" fill="url(#sbWallSide)" stroke="#38bdf8" stroke-opacity="0.28" stroke-width="1"/>
        <!-- Edited window cutout -->
        <rect x="200" y="62" width="24" height="24" rx="2" fill="#0b1018" stroke="#00d2ff" stroke-width="1.6"/>
        <line x1="200" y1="74" x2="224" y2="74" stroke="#00d2ff" stroke-opacity="0.35" stroke-width="1"/>
        <line x1="212" y1="62" x2="212" y2="86" stroke="#00d2ff" stroke-opacity="0.35" stroke-width="1"/>

        <!-- Sleek 3D Ramp ascending to the build -->
        <polygon points="62,134 146,56 196,56 112,134" fill="url(#sbRampTop)" stroke="#7dd3fc" stroke-width="1.6"/>
        <polygon points="112,134 196,56 196,64 112,142" fill="#0e7490" fill-opacity="0.85"/>
        <line x1="88" y1="110" x2="138" y2="110" stroke="#e0f2fe" stroke-opacity="0.25" stroke-width="1"/>
        <line x1="116" y1="84" x2="166" y2="84" stroke="#e0f2fe" stroke-opacity="0.25" stroke-width="1"/>

        <!-- Minimalist precision crosshair accent -->
        <g transform="translate(212, 74)">
          <circle r="16" fill="none" stroke="#00d2ff" stroke-opacity="0.35" stroke-width="1.2"/>
          <line x1="-22" y1="0" x2="-12" y2="0" stroke="#00d2ff" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="12" y1="0" x2="22" y2="0" stroke="#00d2ff" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="0" y1="-22" x2="0" y2="-12" stroke="#00d2ff" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="0" y1="12" x2="0" y2="22" stroke="#00d2ff" stroke-width="1.5" stroke-linecap="round"/>
          <circle r="2" fill="#ffffff"/>
        </g>
      </svg>
    `
  }
];

export function initPortal(gridEl, { onLaunchBuildRoyale }, lang = null) {
  if (!gridEl) return;
  gridEl.innerHTML = '';

  const playableGames = PORTAL_GAMES.filter((g) => g.playable);
  gridEl.classList.toggle('single-hero', playableGames.length === 1);

  for (const game of playableGames) {
    const statusLabel = t(game.statusKey, null, lang);
    const tagline = t(game.taglineKey, null, lang);
    const playLabel = t('portal_play', null, lang);

    const card = document.createElement('article');
    card.className = `game-card ${game.playable ? 'playable' : 'locked'}`;
    if (game.playable) {
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${game.title} — ${playLabel}`);
    } else {
      card.tabIndex = -1;
      card.setAttribute('aria-disabled', 'true');
    }

    card.innerHTML = `
      <div class="card-art" style="background: ${game.bg}">
        ${game.svg}
        <span class="card-badge ${game.playable ? 'live' : 'soon'}">${statusLabel}</span>
        <div class="card-scrim"></div>
        <div class="card-footer">
          <div class="card-title-group">
            <div class="card-title">${game.title}</div>
            <div class="card-subtitle">${tagline}</div>
          </div>
          ${game.playable ? `<span class="card-play-btn">${playLabel}</span>` : ''}
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
