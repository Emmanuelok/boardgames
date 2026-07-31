import { useEffect, useState } from 'react';
import {
  activatePwaUpdate,
  downloadForOffline,
  promptPwaInstall,
  registerPwa,
  usePwaStatus,
} from './register';
import './PwaStatus.css';

export default function PwaStatus() {
  const status = usePwaStatus();
  const [message, setMessage] = useState('');

  useEffect(() => {
    void registerPwa();
  }, []);

  const cache = async () => {
    const ok = await downloadForOffline();
    setMessage(ok ? 'The strategy library is ready offline.' : 'Visited games remain available offline.');
  };

  const install = async () => {
    const accepted = await promptPwaInstall();
    setMessage(accepted ? 'GrandMaster is being installed.' : 'Installation was not completed.');
  };

  const update = () => {
    if (!activatePwaUpdate()) return;
    setMessage('Update prepared. Reload after finishing any active game.');
  };

  return (
    <section className="pwa-card glass" aria-labelledby="pwa-title">
      <div className="pwa-heading">
        <span className={`pwa-dot ${status.online ? 'online' : 'offline'}`} aria-hidden="true" />
        <div>
          <h2 id="pwa-title">Play anywhere</h2>
          <span>{status.online ? 'Online now' : 'Offline mode'}</span>
        </div>
      </div>
      <p>
        Save the interface, game engines and artwork on this device. Progress already stays local and continues without a connection.
      </p>
      <div className="pwa-actions">
        <button type="button" className="btn primary sm" disabled={!status.supported || status.caching} onClick={() => void cache()}>
          {status.caching ? 'Downloading…' : status.cached ? '✓ Ready offline' : 'Download for offline'}
        </button>
        {status.installAvailable && !status.installed ? (
          <button type="button" className="btn sm" onClick={() => void install()}>Install app</button>
        ) : null}
        {status.updateAvailable ? (
          <button type="button" className="btn sm" onClick={update}>Prepare update</button>
        ) : null}
      </div>
      {!status.supported ? <small>Use a modern browser to install this experience.</small> : null}
      {status.installed ? <small>Installed as an app on this device.</small> : null}
      {status.error ? <small className="pwa-error">{status.error}</small> : null}
      <span className="pwa-live" role="status" aria-live="polite">{message}</span>
    </section>
  );
}
