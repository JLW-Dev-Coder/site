# STYLE.md — virtuallaunch.pro

Last updated: 2026-04-05

---

## 1. Header
**Product:** Virtual Launch Pro
**Stack:** Tailwind CSS + CSS custom properties + CSS Modules
**Global tokens:** `web/app/globals.css` and `web/tailwind.config.ts`

## 2. Stack
- **CSS approach:** Tailwind utilities + custom properties for dark theme
- **Global tokens location:** `web/app/globals.css` (:root variables) + `web/tailwind.config.ts` (extended theme)
- **What is NOT used:** Bootstrap, Styled Components, Emotion, external CSS frameworks

## 3. Design Tokens

### Colors
```css
/* CSS Custom Properties (globals.css) */
--bg: #070a10         /* Dark background */
--fg: rgba(255, 255, 255, 0.92)  /* Primary text */
--muted: rgba(255, 255, 255, 0.66)  /* Secondary text */
--card: rgba(255, 255, 255, 0.06)   /* Card backgrounds */
--line: rgba(255, 255, 255, 0.12)   /* Borders/dividers */

/* Tailwind Extensions */
brand-orange: #f97316  /* Primary brand orange */
brand-amber: #f59e0b   /* Secondary brand amber */
brand-400: #fb923c     /* Orange 400 variant */
brand-500: #f97316     /* Orange 500 (same as brand-orange) */
ink-900: #0f172a       /* Deep dark ink */
```

### Typography
- **Font family:** var(--font-raleway), Inter, system-ui, sans-serif
- **Font loading:** Next.js font optimization

### Gradients
- **Brand gradient:** linear-gradient(to right, #f97316, #f59e0b)

### Breakpoints
Standard Tailwind breakpoints:
- sm: 640px
- md: 768px  
- lg: 1024px
- xl: 1280px
- 2xl: 1536px

## 4. Layout Patterns
- **Max width:** Container utilities (max-w-7xl, max-w-6xl)
- **Section padding:** py-16 (desktop), py-12 (tablet), py-8 (mobile)
- **Grid:** Tailwind grid utilities
- **Cards:** bg-card backdrop-blur border border-line/20 rounded-xl

## 5. Button Patterns
- **Primary:** bg-gradient-brand text-white hover:opacity-90 px-6 py-3 rounded-lg
- **Secondary:** border border-line text-fg hover:bg-card px-6 py-3 rounded-lg  
- **Small:** px-4 py-2 text-sm rounded-md

## 6. Typography Patterns
- **h1:** text-4xl md:text-6xl font-bold text-fg
- **h2:** text-3xl md:text-4xl font-bold text-fg
- **Body:** text-base text-fg leading-relaxed
- **Muted:** text-muted
- **Badge:** px-3 py-1 bg-brand-orange/20 text-brand-orange rounded-full text-sm

## 7. Existing Components
Located in `web/components/`:
- Header: Navigation with brand logo
- Footer: Links, legal, contact
- PricingCard: Membership tier display
- Hero: Landing page hero sections

## 8. Page File Pattern
Per page directory:
- page.tsx (main component)
- layout.tsx (if custom layout needed)
- loading.tsx (loading state)
- error.tsx (error boundary)

## 9. Self-Check
Before delivering styled pages:
- [ ] Uses only Tailwind utilities + custom properties
- [ ] Dark theme tokens (--bg, --fg, --muted, --card, --line)
- [ ] Brand colors (brand-orange, brand-amber)
- [ ] Responsive breakpoints applied (sm:, md:, lg:)
- [ ] Proper contrast ratios maintained
- [ ] No external CSS framework imports
- [ ] Font family uses var(--font-raleway) fallback chain