import { loadFont } from '@remotion/google-fonts/Baloo2';

const font = loadFont('normal', {
  weights: ['500', '700', '800'],
  subsets: ['latin', 'vietnamese'],
});

export const FONT_FAMILY = font.fontFamily;

export const COLORS = {
  skyTop: '#6cc6ff',
  skyBottom: '#d8f1ff',
  title: '#ff7a1a',
  titleStroke: '#ffffff',
  badgeBg: '#ffffff',
  badgeBorder: '#ff7a1a',
  badgeText: '#e8590c',
  ring: '#ffd43b',
  subtitleBg: 'rgba(20, 24, 40, 0.72)',
  subtitleText: '#ffffff',
  cardBg: 'rgba(255,255,255,0.94)',
  accent: '#2f9e44',
};
