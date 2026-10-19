import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import App from './App';

test('מציג את כפתור קובץ האבחון ואין קישור לגיטהב', () => {
  render(<App />);
  const linkElement = screen.getByText(/שמירת קובץ אבחון/i);
  expect(linkElement).to.exist;
  expect(screen.queryByText(/github/i)).toBeNull();
});
