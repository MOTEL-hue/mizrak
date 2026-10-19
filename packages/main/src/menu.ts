import { Menu, type MenuItemConstructorOptions } from 'electron';

// תפריט עליון בעברית (ברירת המחדל של התוכנה באנגלית)
export function setHebrewMenu() {
  const template: MenuItemConstructorOptions[] = [
    { label: 'קובץ', submenu: [{ role: 'quit', label: 'יציאה' }] },
    {
      label: 'עריכה',
      submenu: [
        { role: 'undo', label: 'ביטול' },
        { role: 'redo', label: 'חזרה' },
        { type: 'separator' },
        { role: 'cut', label: 'גזירה' },
        { role: 'copy', label: 'העתקה' },
        { role: 'paste', label: 'הדבקה' },
        { role: 'selectAll', label: 'בחירת הכול' },
      ],
    },
    {
      label: 'תצוגה',
      submenu: [
        { role: 'reload', label: 'רענון' },
        { role: 'resetZoom', label: 'גודל רגיל' },
        { role: 'zoomIn', label: 'הגדלה' },
        { role: 'zoomOut', label: 'הקטנה' },
        { role: 'togglefullscreen', label: 'מסך מלא' },
      ],
    },
    {
      label: 'חלון',
      submenu: [
        { role: 'minimize', label: 'מזעור' },
        { role: 'close', label: 'סגירה' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
