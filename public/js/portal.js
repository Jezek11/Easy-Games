import { audio } from './audio.js';

const LOCK_SVG = `
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2"/>
    <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
  </svg>
`;

const PORTAL_GAMES = [
  {
    id: 'buildroyale',
    title: 'Ultimate Arena 3D',
    subtitle: '1v1 Build & Battle Royale',
    playable: true,
    bg: 'radial-gradient(circle at 75% 25%, #1d4ed8 0%, #0d1326 62%, #07080c 100%)',
    svg: `
      <svg viewBox="0 0 280 176" width="100%" height="100%" aria-hidden="true">
        <defs>
          <linearGradient id="cRamp1" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="#60a5fa" stop-opacity="0.85"/>
          </linearGradient>
          <linearGradient id="cWood1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#334155"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </linearGradient>
        </defs>
        <g stroke="#3b82f6" stroke-opacity="0.2" stroke-width="1">
          <line x1="0" y1="138" x2="280" y2="138"/>
          <line x1="0" y1="156" x2="280" y2="156"/>
          <line x1="50" y1="124" x2="12" y2="176"/>
          <line x1="140" y1="124" x2="140" y2="176"/>
          <line x1="230" y1="124" x2="268" y2="176"/>
        </g>
        <polygon points="44,142 120,68 168,68 92,142" fill="url(#cRamp1)" stroke="#93c5fd" stroke-width="2"/>
        <rect x="166" y="46" width="68" height="96" rx="4" fill="url(#cWood1)" stroke="#3b82f6" stroke-width="1.6"/>
        <line x1="166" y1="78" x2="234" y2="78" stroke="#1e293b" stroke-width="1.5"/>
        <line x1="166" y1="110" x2="234" y2="110" stroke="#1e293b" stroke-width="1.5"/>
        <circle cx="142" cy="60" r="15" stroke="#ef4444" stroke-width="2.2" fill="none"/>
        <circle cx="142" cy="60" r="2.6" fill="#ef4444"/>
      </svg>
    `
  },
  {
    id: 'tactical',
    title: 'Tactical 5v5',
    subtitle: 'Round-based team FPS',
    playable: false,
    bg: 'radial-gradient(circle at 75% 25%, #7f1d1d 0%, #1c0d12 62%, #07080c 100%)',
    svg: `
      <svg viewBox="0 0 280 176" width="100%" height="100%" aria-hidden="true">
        <circle cx="140" cy="84" r="46" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="10 6" opacity="0.72"/>
        <circle cx="140" cy="84" r="26" fill="none" stroke="#f87171" stroke-width="1.5" opacity="0.55"/>
        <polygon points="122,108 140,52 158,108" fill="#ef4444" fill-opacity="0.35" stroke="#fca5a5" stroke-width="1.8"/>
      </svg>
    `
  },
  {
    id: 'drift',
    title: 'Drift Arena',
    subtitle: '3D arcade racing',
    playable: false,
    bg: 'radial-gradient(circle at 75% 25%, #1e3a8a 0%, #121524 62%, #07080c 100%)',
    svg: `
      <svg viewBox="0 0 280 176" width="100%" height="100%" aria-hidden="true">
        <path d="M24,132 Q112,32 256,110" fill="none" stroke="#ef4444" stroke-width="5" stroke-linecap="round" opacity="0.88"/>
        <path d="M34,144 Q116,48 248,122" fill="none" stroke="#60a5fa" stroke-width="2" stroke-dasharray="6 6" opacity="0.65"/>
        <rect x="110" y="68" width="56" height="22" rx="5" transform="rotate(-14 138 79)" fill="#3b82f6" fill-opacity="0.6" stroke="#93c5fd" stroke-width="1.5"/>
      </svg>
    `
  },
  {
    id: 'zombie',
    title: 'Zombie Siege',
    subtitle: 'Co-op wave defense',
    playable: false,
    bg: 'radial-gradient(circle at 75% 25%, #450a0a 0%, #101420 62%, #07080c 100%)',
    svg: `
      <svg viewBox="0 0 280 176" width="100%" height="100%" aria-hidden="true">
        <rect x="104" y="48" width="72" height="72" rx="12" fill="#ef4444" fill-opacity="0.2" stroke="#f87171" stroke-width="2"/>
        <rect x="122" y="76" width="11" height="11" rx="2" fill="#ef4444"/>
        <rect x="147" y="76" width="11" height="11" rx="2" fill="#ef4444"/>
        <rect x="124" y="98" width="32" height="6" rx="3" fill="#3b82f6" opacity="0.85"/>
      </svg>
    `
  },
  {
    id: 'skywars',
    title: 'SkyWars Blitz',
    subtitle: 'Aerial arena PvP',
    playable: false,
    bg: 'radial-gradient(circle at 75% 25%, #1d4ed8 0%, #0f172a 62%, #07080c 100%)',
    svg: `
      <svg viewBox="0 0 280 176" width="100%" height="100%" aria-hidden="true">
        <polygon points="80,94 140,58 200,94 140,124" fill="#3b82f6" fill-opacity="0.34" stroke="#93c5fd" stroke-width="2"/>
        <polygon points="80,94 140,124 140,136 80,106" fill="#2563eb" fill-opacity="0.45"/>
        <polygon points="200,94 140,124 140,136 200,106" fill="#ef4444" fill-opacity="0.42"/>
      </svg>
    `
  }
];

export function initPortal(gridEl, { onLaunchBuildRoyale, onToast }) {
  let activeFilter = 'all';

  function renderCards() {
    gridEl.innerHTML = '';
    const filtered = PORTAL_GAMES.filter((g) => {
      if (activeFilter === 'playable') return g.playable;
      if (activeFilter === 'upcoming') return !g.playable;
      return true;
    });

    for (const game of filtered) {
      const card = document.createElement('article');
      card.className = `game-card ${game.playable ? 'playable' : 'locked'}`;
      card.tabIndex = 0;

      card.innerHTML = `
        <div class="card-art" style="background: ${game.bg}">
          ${game.svg}
          <span class="card-badge ${game.playable ? 'live' : 'soon'}">
            ${game.playable ? 'PLAY • 60 FPS' : 'SOON'}
          </span>
          ${game.playable ? '' : `<div class="lock-corner" title="Coming Soon">${LOCK_SVG}</div>`}
          <div class="card-scrim"></div>
          <div class="card-overlay-info">
            <div class="card-title">${game.title}</div>
            <div class="card-subtitle">${game.subtitle}</div>
          </div>
          ${game.playable ? '<span class="card-hover-cta">Play →</span>' : ''}
        </div>
      `;

      const handleActivate = () => {
        audio.playUiClick();
        if (game.playable) {
          onLaunchBuildRoyale();
        } else {
          onToast(`"${game.title}" is currently in development.`);
        }
      };

      card.addEventListener('click', handleActivate);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate();
        }
      });

      gridEl.appendChild(card);
    }
  }

  const filterBtns = document.querySelectorAll('[data-catalog-filter]');
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      audio.playUiClick();
      activeFilter = btn.dataset.catalogFilter || 'all';
      filterBtns.forEach((b) => b.classList.toggle('active', b === btn));
      renderCards();
    });
  });

  renderCards();
}
