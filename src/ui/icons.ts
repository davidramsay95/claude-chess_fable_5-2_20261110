const icon = (body: string): string =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Interface icons, drawn for this game on a 24 x 24 grid. */
export const ICONS = {
  first: icon('<path d="M6 5v14"/><path d="M19 5l-9 7 9 7z"/>'),
  previous: icon('<path d="M16 5l-9 7 9 7z"/>'),
  next: icon('<path d="M8 5l9 7-9 7z"/>'),
  last: icon('<path d="M18 5v14"/><path d="M5 5l9 7-9 7z"/>'),
  flip: icon('<path d="M7 4v15"/><path d="M3.5 15.5L7 19l3.5-3.5"/><path d="M17 20V5"/><path d="M13.5 8.5L17 5l3.5 3.5"/>'),
  soundOn: icon('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a7.8 7.8 0 0 1 0 11"/>'),
  soundOff: icon('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M16 9.5l5 5"/><path d="M21 9.5l-5 5"/>'),
  plus: icon('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  flag: icon('<path d="M6 21V4"/><path d="M6 5h11l-2.5 4L17 13H6"/>'),
  download: icon('<path d="M12 4v11"/><path d="M7.5 11L12 15.5 16.5 11"/><path d="M5 19.5h14"/>'),
  upload: icon('<path d="M12 15.5v-11"/><path d="M7.5 9L12 4.5 16.5 9"/><path d="M5 19.5h14"/>'),
  copy: icon('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H6a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6 14h1"/>'),
} as const;
