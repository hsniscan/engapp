import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/ui';
import { buttonClasses } from './button-styles';
import { TabBar } from './TabBar';

/** The (+) pill: the span around the icon inside the "Ekle" button. */
function addPill(): HTMLElement {
  const pill = screen.getByTestId('nav-add').firstElementChild;
  if (!(pill instanceof HTMLElement)) throw new Error('no pill');
  return pill;
}

function classes(el: HTMLElement): string[] {
  return el.className.split(/\s+/);
}

describe('TabBar (+) pill (review 2026-11-26 #6)', () => {
  it('has exactly one background: the solid accent on an add page, so the white (+) shows', () => {
    renderRoute(<TabBar isActive={() => false} addSection />);
    const c = classes(addPill());
    expect(c).toContain('bg-accent');
    expect(c).toContain('text-accent-fg');
    expect(c).not.toContain('bg-accent-soft');
  });

  it('is the soft tone elsewhere, with no solid-accent class left over', () => {
    renderRoute(<TabBar isActive={() => false} />);
    const c = classes(addPill());
    expect(c).toContain('bg-accent-soft');
    expect(c).not.toContain('bg-accent');
    expect(c).not.toContain('text-accent-fg');
  });

  it('is the solid accent while the add sheet is open', () => {
    renderRoute(<TabBar isActive={() => false} addOpen />);
    expect(classes(addPill())).not.toContain('bg-accent-soft');
  });
});

describe('buttonClasses wrap (review 2026-11-26 #10)', () => {
  it('keeps one line and a fixed height by default', () => {
    const c = buttonClasses({ size: 'md' }).split(' ');
    expect(c).toContain('whitespace-nowrap');
    expect(c).toContain('h-11');
  });

  it('lets the label wrap with a minimum height instead of a fixed one', () => {
    const c = buttonClasses({ size: 'md', wrap: true }).split(' ');
    expect(c).not.toContain('whitespace-nowrap');
    expect(c).not.toContain('h-11');
    expect(c).toEqual(expect.arrayContaining(['whitespace-normal', 'max-w-full', 'min-h-11']));
  });
});
