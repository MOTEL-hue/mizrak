import { useState } from 'react';
import { StoresProvider } from '../store';
import './App.css';
import Body from './Body';
import BudgetPage from './budget/BudgetPage';
import TopBar from './topBar/TopBar';

export type Page = 'budget' | 'mizrak';

function App() {
  const [page, setPage] = useState<Page>('budget');
  return (
    <StoresProvider>
      <div className="App">
        <TopBar page={page} onPage={setPage} />
        {page === 'budget' ? <BudgetPage /> : <Body />}
      </div>
    </StoresProvider>
  );
}

export default App;
