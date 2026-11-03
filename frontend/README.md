# Inferxe Frontend Application

Modern React 19 + TypeScript + Vite web application for the Inferxe GPU Marketplace & Control Plane.

## Directory Structure

```
frontend/
├── public/             # Static public assets (images, logos, favicon, robots, sitemap)
├── src/
│   ├── components/     # UI components
│   │   ├── auth/       # Authentication guards & OTP verification
│   │   ├── bot/        # Inferxe AI Chatbot companion
│   │   ├── dashboard/  # Control plane layouts, maps, graphs, readouts
│   │   ├── layout/     # Navigation, footer, command palette, ambient effects
│   │   ├── ui/         # Glassmorphic buttons, cards, counters, tilts
│   │   ├── visuals/    # GPU card art, provider marquees, routing diagrams
│   │   └── widgets/    # Calculator, API explorer, compat matrix
│   ├── pages/          # Application routes (Home, Platform, GPUs, Pricing, Login, Dashboard)
│   ├── styles/         # CSS design system, typography tokens, glassmorphism
│   ├── lib/            # State stores, API clients, calculation engines, hooks
│   ├── data/           # GPU specs, providers, benchmark data
│   ├── types/          # TypeScript domain definitions
│   ├── App.tsx         # Route router & motion shell
│   └── main.tsx        # Application bootstrap entrypoint
├── index.html          # HTML entrypoint
├── vite.config.ts      # Vite bundler & dev server config
├── tsconfig.json       # TypeScript configuration
└── package.json        # Frontend dependencies & scripts
```

## Running the Frontend

```bash
# Development server (http://127.0.0.1:5173)
npm run dev

# Production build
npm run build

# TypeScript validation
npm run typecheck
```

