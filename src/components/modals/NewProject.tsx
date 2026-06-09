import { useState } from 'react';
import { useStore } from '../../stores/useStore';
import { Icon } from '../Icon';

export function NewProjectModal() {
  const open = useStore(s => s.openModal === 'new-project');
  const setOpenModal = useStore(s => s.setOpenModal);
  const newProject = useStore(s => s.newProject);
  const [name, setName] = useState('New Project');
  const [client, setClient] = useState('');

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={() => setOpenModal(null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div>
            <h2>Open or start a project</h2>
            <div className="sub">Create a fresh project — or use the welcome screen for a template.</div>
          </div>
          <button className="icon-close" onClick={() => setOpenModal(null)}><Icon name="x" size={16}/></button>
        </div>
        <div className="modal-body">
          <div className="field-row" style={{ gridTemplateColumns: '120px 1fr' }}>
            <label>Project name</label>
            <input className="text-input" value={name} onChange={e => setName(e.target.value)}/>
          </div>
          <div className="field-row" style={{ gridTemplateColumns: '120px 1fr' }}>
            <label>Client</label>
            <input className="text-input" value={client} onChange={e => setClient(e.target.value)}/>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => { setOpenModal('welcome'); }}>Pick a template…</button>
          <button className="btn btn-cta" onClick={() => { newProject(name, client); }}>
            <Icon name="plus" size={14}/> Create project
          </button>
        </div>
      </div>
    </div>
  );
}
