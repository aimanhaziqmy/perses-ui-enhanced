import '@mui/material/styles';

export interface SurfacePalette {
  bgCanvas: string;
  bgSurface: string;
  bgSidebar: string;
  bgHeader: string;
  bgSubtle: string;
  bgHover: string;
  bgActiveNav: string;
  borderSubtle: string;
  chartBarPurple: string;
  tableHeaderBg: string;
}

declare module '@mui/material/styles' {
  interface Palette {
    surface: SurfacePalette;
  }
  interface PaletteOptions {
    surface?: SurfacePalette;
  }
}
