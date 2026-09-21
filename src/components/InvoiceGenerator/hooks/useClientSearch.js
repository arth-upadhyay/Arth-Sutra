
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getAllClients, saveClient } from '../../../store';
import { toast } from '../components/../../Toast';

// The exact client shape the invoice form (and saved bill `data.client`) uses.
export const toClientShape = (c = {}) => ({
  name: c.name || '',
  address: c.address || '',
  city: c.city || '',
  pin: c.pin || '',
  state: c.state || '',
  gstin: c.gstin || '',
  country: c.country || '',
  email: c.email || '',
  phone: c.phone || '',
  isSEZ: !!c.isSEZ,
  licence: c.licence || '',
});

export function useClientSearch({
  clientName = '',
  onSelect = null,             // (clientShape, sourceRecord) => void
  onApplyPreferences = null,   // (sourceRecord) => void — new bills only
  editingBill = null,
} = {}) {
  const [savedClients, setSavedClients] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [pickerIdx, setPickerIdx] = useState(-1);
  const [selectedClientId, setSelectedClientId] = useState(null);

  // Create/edit modal state (render ClientModal with these props)
  const [modalOpen, setModalOpen] = useState(false);
  const [modalClient, setModalClient] = useState(null);
  const [isEditingClient, setIsEditingClient] = useState(false);

  // Attach to the name <input> and the suggestions dropdown for click-outside.
  const nameInputRef = useRef(null);
  const suggestionsRef = useRef(null);

  // ---- Load directory + match an existing typed name to a saved client --------
  useEffect(() => {
    getAllClients().then(clients => {
      setSavedClients(clients);
      if (clientName.trim()) {
        const match = clients.find(c => c.name.toLowerCase() === clientName.trim().toLowerCase());
        if (match) setSelectedClientId(match.id);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshClients = useCallback(() => {
    return getAllClients().then(setSavedClients).catch(() => {});
  }, []);

  // ---- Autocomplete filtering (monolith behaviour: empty query ⇒ show all) -----
  const filteredClients = useMemo(() => {
    const q = clientName.trim().toLowerCase();
    if (!q) return savedClients;
    return savedClients.filter(cli => cli.name.toLowerCase().includes(q));
  }, [clientName, savedClients]);

  // Reset the keyboard cursor whenever the query changes.
  useEffect(() => { setPickerIdx(-1); }, [clientName]);

  // ---- Click-outside dismiss -----------------------------------------------------
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target) &&
          nameInputRef.current && !nameInputRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ---- Selection -------------------------------------------------------------------
  const selectClient = useCallback((cli) => {
    if (!cli) return;
    onSelect?.(toClientShape(cli), cli);
    setSelectedClientId(cli.id);
    setShowSuggestions(false);
    setPickerIdx(-1);
    // Client preferences only seed NEW bills — an edit must keep its own options.
    if (!editingBill) onApplyPreferences?.(cli);
    toast(`Loaded client: ${cli.name}`, 'info');
  }, [onSelect, onApplyPreferences, editingBill]);

  const handleNameKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      setPickerIdx(-1);
      return;
    }
    if (!showSuggestions || filteredClients.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setPickerIdx(i => (i + 1) % filteredClients.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setPickerIdx(i => (i <= 0 ? filteredClients.length - 1 : i - 1));
    } else if (e.key === 'Enter' && pickerIdx >= 0) {
      e.preventDefault();
      selectClient(filteredClients[pickerIdx]);
    }
  }, [showSuggestions, filteredClients, pickerIdx, selectClient]);

  // ---- Create-on-the-fly / edit modal -----------------------------------------------
  // Prefills the modal with whatever the user already typed into the form.
  const openAddClientModal = useCallback((currentFormClient = {}) => {
    setModalClient({
      name: currentFormClient.name || '',
      address: currentFormClient.address || '',
      city: currentFormClient.city || '',
      pin: currentFormClient.pin || '',
      state: currentFormClient.state || '',
      gstin: currentFormClient.gstin || '',
      licence: currentFormClient.licence || '',
    });
    setIsEditingClient(false);
    setModalOpen(true);
    setShowSuggestions(false);
  }, []);

  const openEditClientModal = useCallback((cli) => {
    setModalClient(cli);
    setIsEditingClient(true);
    setModalOpen(true);
  }, []);

  const closeClientModal = useCallback(() => setModalOpen(false), []);

  /**
   * Persist the modal's form data (create or update), refresh the directory,
   * push the result into the invoice form, and return the saved record.
   */
  const saveClientFromModal = useCallback(async (formData) => {
    const data = { ...formData };
    if (isEditingClient && modalClient?.id) data.id = modalClient.id;

    await saveClient(data);
    const updated = await getAllClients();
    setSavedClients(updated);

    onSelect?.(toClientShape(data), data);

    if (isEditingClient && modalClient?.id) {
      setSelectedClientId(modalClient.id);
      toast(`Client "${data.name}" updated!`, 'success');
    } else {
      // The newly created record is the one whose name matches and whose id
      // wasn't in the directory before this save.
      const found = updated.find(c => c.name === data.name.trim() && !savedClients.some(old => old.id === c.id));
      if (found) setSelectedClientId(found.id);
      toast(`Client "${data.name}" saved!`, 'success');
    }
    setModalOpen(false);
    return data;
  }, [isEditingClient, modalClient, savedClients, onSelect]);

  // ---- Preference write-back (used by useInvoicePersistence after save) -------------
  const patchClient = useCallback((clientRecord, patch) => {
    const updatedClient = { ...clientRecord, ...patch };
    saveClient(updatedClient).then(() => {
      setSavedClients(prev => prev.map(c => (c.id === updatedClient.id ? updatedClient : c)));
    }).catch(() => {});
    return updatedClient;
  }, []);

  return {
    // data
    savedClients,
    filteredClients,
    selectedClientId, setSelectedClientId,
    // autocomplete UI state
    showSuggestions, setShowSuggestions,
    pickerIdx, setPickerIdx,
    nameInputRef,
    suggestionsRef,
    selectClient,
    handleNameKeyDown,
    // create-on-the-fly modal
    clientModal: { open: modalOpen, client: modalClient, isEditing: isEditingClient },
    openAddClientModal,
    openEditClientModal,
    closeClientModal,
    saveClientFromModal,
    // misc
    patchClient,
    refreshClients,
  };
}

export default useClientSearch;