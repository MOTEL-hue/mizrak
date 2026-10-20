// האם התוכנה באמת נסגרת. אחרת סגירת החלון רק מסתירה אותה, והיא ממשיכה לפעול ברקע
let quitting = false;
export const setQuitting = () => {
  quitting = true;
};
export const isQuitting = () => quitting;
