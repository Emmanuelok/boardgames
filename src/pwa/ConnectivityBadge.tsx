import { Link } from 'react-router-dom';
import { activatePwaUpdate, usePwaStatus } from './register';
import './ConnectivityBadge.css';

export default function ConnectivityBadge() {
  const status = usePwaStatus();
  if (status.online && !status.updateAvailable) return null;
  return (
    <aside className={`connectivity-badge ${status.online ? 'update' : 'offline'}`} role="status" aria-live="polite">
      <i aria-hidden="true" />
      <div>
        <strong>{status.online ? 'Update ready' : 'Working offline'}</strong>
        <span>{status.online ? 'Apply after your current game.' : 'Local games and saved progress remain available.'}</span>
      </div>
      {status.updateAvailable
        ? <button type="button" onClick={() => activatePwaUpdate()}>Prepare</button>
        : <Link to="/settings#offline">Details</Link>}
    </aside>
  );
}
