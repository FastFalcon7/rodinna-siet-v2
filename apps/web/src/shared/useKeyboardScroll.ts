import { useEffect } from 'react';

function isEditable(el: EventTarget | null): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  );
}

/**
 * iOS PWA (ladenie 07/2026): pri PRVOM zaostrení textového poľa po studenom
 * štarte appky Safari neposunie pole nad klávesnicu — visual viewport sa
 * zmenší až po otvorení klávesnice a stránka ostane odscrollovaná zle.
 * (Pri ďalších zaostreniach to už iOS robí sám.)
 *
 * Fix: globálne počúvame focusin + zmenu visualViewport a zaostrené pole
 * doscrollujeme do stredu viditeľnej časti. Mountuje sa raz v app shelli.
 */
export function useKeyboardScroll(): void {
  useEffect(() => {
    let timer: number | null = null;

    const scrollToActive = () => {
      const el = document.activeElement;
      if (isEditable(el)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };

    const onFocusIn = (e: FocusEvent) => {
      if (!isEditable(e.target)) return;
      // Klávesnica sa vysúva ~250 ms; scroll až keď je viewport finálny.
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(scrollToActive, 350);
    };

    // Zmena visual viewportu (klávesnica hore/dole, rotácia) → doscrolluj.
    const vv = window.visualViewport;
    const onResize = () => scrollToActive();

    document.addEventListener('focusin', onFocusIn);
    vv?.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      vv?.removeEventListener('resize', onResize);
      if (timer) window.clearTimeout(timer);
    };
  }, []);
}
