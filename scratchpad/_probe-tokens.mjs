import { resolveWidgetTheme } from '../src/server/widgetThemes.ts';
for (const p of ['tesla','booking','cupertino','midnight']) {
  const t = resolveWidgetTheme({ themePreset: p }).tokens;
  console.log(p, 'text='+t['--w-text'], 's2text='+t['--w-surface-2-text'], 'fg='+t['--w-fg'], 'inputbg='+t['--w-input-bg'], 'surf2='+t['--w-surface-2'], 'accent='+t['--w-accent'], 'accSurf='+t['--w-accent-surface'], 'accOnSurf='+t['--w-accent-on-surface']);
}
