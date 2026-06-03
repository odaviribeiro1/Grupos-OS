import { test, expect, gotoTimed, shot } from "../helpers/harness";

/**
 * Visual (glassmorphism dark) + responsivo do /setup. Roda na instância fresca,
 * sem login. Valida tokens de design e ausência de overflow horizontal.
 */
test.describe("Visual + responsivo — /setup", () => {
  test("design tokens: background #0A0A0F, card glass, botão gradiente 135deg", async ({ page }, testInfo) => {
    await gotoTimed(page, "/setup", testInfo);

    // Sem light mode: background base #0A0A0F (rgb(10,10,15)).
    const bg = await page.evaluate(() => {
      const el = document.querySelector(".min-h-screen") as HTMLElement;
      return el ? getComputedStyle(el).backgroundColor : getComputedStyle(document.body).backgroundColor;
    });
    expect(bg.replace(/\s/g, "")).toBe("rgb(10,10,15)");

    // Card: blur 40px + radius 16px + borda azulada.
    const card = page.locator("section").first();
    const cardStyle = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        backdrop: cs.backdropFilter || (cs as any).webkitBackdropFilter,
        radius: cs.borderTopLeftRadius,
        border: cs.borderColor,
      };
    });
    expect(cardStyle.backdrop).toContain("blur(40px)");
    expect(cardStyle.radius).toBe("16px");
    expect(cardStyle.border.replace(/\s/g, "")).toContain("59,130,246");

    // Botão primário: gradiente 135deg #1E3A8A→#3B82F6, fonte Inter.
    const btn = page.getByRole("button", { name: /Já tenho tudo isso/i });
    const btnStyle = await btn.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundImage, font: cs.fontFamily, h: el.getBoundingClientRect().height };
    });
    expect(btnStyle.bg).toContain("135deg");
    expect(btnStyle.bg).toMatch(/rgb\(30,\s*58,\s*138\)/);
    expect(btnStyle.bg).toMatch(/rgb\(59,\s*130,\s*246\)/);
    expect(btnStyle.font.toLowerCase()).toContain("inter");
    expect(btnStyle.h, "tap target ≥ 44px").toBeGreaterThanOrEqual(44);

    await shot(page, "03v-setup-desktop-1280", testInfo);
  });

  for (const width of [375, 768, 1280]) {
    test(`responsivo @${width}px: sem overflow horizontal, tap targets ≥ 44px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoTimed(page, "/setup", testInfo);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `overflow horizontal @${width}px`).toBeLessThanOrEqual(1);

      const btnH = await page
        .getByRole("button", { name: /Já tenho tudo isso/i })
        .evaluate((el) => el.getBoundingClientRect().height);
      expect(btnH, `tap target @${width}px`).toBeGreaterThanOrEqual(44);

      await shot(page, `03v-setup-${width}`, testInfo);
    });
  }
});
