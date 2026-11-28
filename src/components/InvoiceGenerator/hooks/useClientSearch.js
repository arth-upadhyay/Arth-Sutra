import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getAllClients, getAllBills, saveClient } from '../../../store';
import {
  normalizeClientKey,
  toClientFormShape,
  mergeSavedAndBillClients,
  filterClientSuggestions,
  buildClientUpsertPayload,
} from '../../../utils/clientDirectory';
import { toast } from '../../Toast';

export const toClientShape = toClientFormShape;

export function useClientSearch({
  clientName = '',
  onSelect = null,             // (clientShape, sourceRecord) => void
  onApplyPreferences = null,   // (sourceRecord) => void — new bills only
  editingBill = null,
} = {}) {
  const [savedClients, setSavedClients] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState(null);

  // Create/edit modal state (render ClientModal with these props)
  const [modalOpen, setModalOpen] = useState(false);
  const [modalClient, setModalClient] = useState(null);
  const [isEditingClient, setIsEditingClient] = useState(false);

  const dbClientsRef = useRef([]);
  const billsRef = useRef([]);
  const initialMatchedRef = useRef(false);

  const refreshClients = useCallback(async () => {
    const [clientsRes, billsRes] = await Promise.allSettled([getAllClients(), getAllBills()]);
    const dbClients = clientsRes.status === 'fulfilled' && Array.isArray(clientsRes.value)
      ? clientsRes.value
      : dbClientsRef.current;
    const bills = billsRes.status === 'fulfilled' && Array.isArray(billsRes.value)
      ? billsRes.value
      : billsRef.current;

    dbClientsRef.current = dbClients;
    billsRef.current = bills;
    const merged = mergeSavedAndBillClients(dbClients, bills);
    setSavedClients(merged);
    return merged;
  }, []);

  // Load directory + historical bill clients on mount
  useEffect(() => {
    let active = true;
    refreshClients().then((merged) => {
      if (!active || initialMatchedRef.current) return;
      initialMatchedRef.current = true;
      const key = normalizeClientKey(clientName);
      if (key) {
        const match = merged.find(c => !c._fromHistory && normalizeClientKey(c.name) === key);
        if (match?.id) setSelectedClientId(match.id);
      }
    }).catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredClients = useMemo(
    () => filterClientSuggestions(savedClients, clientName, 8),
    [savedClients, clientName],
  );

  // ---- Selection (fires immediately when user picks from popup) ----
  const selectClient = useCallback((cli) => {
    if (!cli) return;
    onSelect?.(toClientShape(cli), cli);
    setSelectedClientId(cli._fromHistory ? null : (cli.id || null));
    setShowSuggestions(false);
    // Client preferences only seed NEW bills — an edit keeps its own options.
    if (!editingBill) onApplyPreferences?.(cli);
    toast(`Loaded client: ${cli.name}`, 'info');
  }, [onSelect, onApplyPreferences, editingBill]);

  // ---- Create-on-the-fly / edit modal ----
  const openAddClientModal = useCallback((currentFormClient = {}) => {
    setModalClient({ ...toClientShape(currentFormClient) });
    setIsEditingClient(false);
    setModalOpen(true);
    setShowSuggestions(false);
  }, []);

  const openEditClientModal = useCallback((cli) => {
    const isReal = !!(cli && cli.id && !cli._fromHistory && !String(cli.id).startsWith('hist_'));
    setModalClient(cli);
    setIsEditingClient(isReal);
    setModalOpen(true);
    setShowSuggestions(false);
  }, []);

  const closeClientModal = useCallback(() => setModalOpen(false), []);

  const saveClientFromModal = useCallback(async (formData) => {
    const data = { ...formData };
    if (isEditingClient && modalClient?.id) data.id = modalClient.id;

    const prevIds = new Set(dbClientsRef.current.map(c => c.id));
    await saveClient(data);
    const merged = await refreshClients();

    onSelect?.(toClientShape(data), data);

    if (isEditingClient && modalClient?.id) {
      setSelectedClientId(modalClient.id);
      toast(`Client "${data.name}" updated!`, 'success');
    } else {
      const found = dbClientsRef.current.find(
        c => normalizeClientKey(c.name) === normalizeClientKey(data.name) && !prevIds.has(c.id),
      ) || merged.find(c => !c._fromHistory && normalizeClientKey(c.name) === normalizeClientKey(data.name));
      if (found?.id) setSelectedClientId(found.id);
      toast(`Client "${data.name}" saved!`, 'success');
    }
    setModalOpen(false);
    return data;
  }, [isEditingClient, modalClient, refreshClients, onSelect]);

  // ---- Automatic save/update from invoice form on Save / Download PDF / Print ----
  const upsertClientFromForm = useCallback(async (formClient, preferencePatch = {}) => {
    const payload = buildClientUpsertPayload(formClient, {
      savedClients: dbClientsRef.current,
      selectedClientId,
      preferencePatch,
    });
    if (!payload || !payload.changed) {
      if (payload?.record?.id && !selectedClientId) {
        setSelectedClientId(payload.record.id);
      }
      return payload?.record || null;
    }

    const saved = await saveClient(payload.record);
    await refreshClients();
    if (saved?.id) setSelectedClientId(saved.id);
    return saved;
  }, [selectedClientId, refreshClients]);

  // ---- Preference write-back compatibility helper ----
  const patchClient = useCallback((clientRecord, patch) => {
    const updatedClient = { ...clientRecord, ...patch };
    saveClient(updatedClient).then(() => {
      dbClientsRef.current = dbClientsRef.current.map(c => (c.id === updatedClient.id ? updatedClient : c));
      setSavedClients(mergeSavedAndBillClients(dbClientsRef.current, billsRef.current));
    }).catch(() => {});
    return updatedClient;
  }, []);

  return {
    savedClients,
    filteredClients,
    selectedClientId,
    setSelectedClientId,
    showSuggestions,
    setShowSuggestions,
    selectClient,
    clientModal: { open: modalOpen, client: modalClient, isEditing: isEditingClient },
    openAddClientModal,
    openEditClientModal,
    closeClientModal,
    saveClientFromModal,
    upsertClientFromForm,
    patchClient,
    refreshClients,
  };
}

export default useClientSearch;
