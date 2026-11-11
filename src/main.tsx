import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import { App } from './App';
import { applyTheme, initialTheme } from './ui';
import './style.css';
applyTheme(initialTheme()); // 첫 렌더 전에 테마를 정해 깜빡임을 줄인다
createRoot(document.getElementById('root')!).render(<App />);
