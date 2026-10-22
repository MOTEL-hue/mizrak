import { StoresProvider } from '../store';
import './App.css';
import BudgetPage from './budget/BudgetPage';
import SyncPage from './sync/SyncPage';

// התקציב הוא התוכנה עצמה; "מזרק" (משיכת תנועות מהבנקים) הוא דף הסנכרון שבתוכו
function App() {
  return (
    <StoresProvider>
      <div className="App">
        <BudgetPage sync={<SyncPage />} />
      </div>
    </StoresProvider>
  );
}

export default App;
