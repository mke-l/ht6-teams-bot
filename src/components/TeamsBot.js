import React, { useState, useEffect } from "react";
import { getAuth } from "firebase/auth";
import { db, signInWithPopup, createMicrosoftProvider } from "../services/firebase";
import { 
  doc, 
  getDoc, 
  setDoc,
  updateDoc,
  collection, 
  getDocs,
} from "firebase/firestore";
import axios from "axios";

/* Firestore structure: (also avaliable in server.js)
organizations/
└── {companyName}/
    └── teamsBot/
        └── details/ <document>
            ├── deployed: boolean,
            ├── botName: string,
            ├── azureSearchIndex: string,
            ├── lastDeployment: timestamp,
            ├── tenantId: string,
            ├── tenantDisplayName: string,
            │
            ├── files/ <Subcollection>
            │   └── {fileName}/
            │       └── chunkIds: [string]
            │
            └── urls/
                └── {urlID}/ <document ID is auto-generated>
                    ├── url: string
                    └── description: string
*/

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:8080";

const LoadingAnimation = ({ message, progress, details }) => (
  <div className="teams-bot-loading-overlay">
    <div className="teams-bot-loading-container">
      {/* Animated Bot Icon */}
      <div className="teams-bot-loading-icon">
        <div className="teams-bot-spinner">
          <div className="teams-bot-spinner-inner"></div>
        </div>
        <div className="teams-bot-robot-face">🤖</div>
      </div>
      
      {/* Main Message */}
      <h3 className="teams-bot-loading-title">{message}</h3>
      
      {/* Progress Bar */}
      {progress !== undefined && (
        <div className="teams-bot-progress-container">
          <div className="teams-bot-progress-bar">
            <div 
              className="teams-bot-progress-fill"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <span className="teams-bot-progress-text">{progress}%</span>
        </div>
      )}
      
      {/* Details */}
      {details && (
        <p className="teams-bot-loading-details">{details}</p>
      )}
      
      {/* Animated Dots */}
      <div className="teams-bot-loading-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  </div>
);

const TeamsBot = ({ isOpen, onClose }) => {
  const [uploadSectionExpanded, setUploadSectionExpanded] = useState(false);
  const [linksSectionExpanded, setLinksSectionExpanded] = useState(false);
  
  // State management
  const [botDetails, setBotDetails] = useState({
    deployed: false,
    botName: "",
    azureSearchIndex: "",
    lastDeployment: null,
    tenantId: null,
    tenantDisplayName: null 
  });
  
  // Current files and URLs (from Firebase subcollections)
  const [currentFiles, setCurrentFiles] = useState([]); // Array of file names (strings)
  const [currentUrls, setCurrentUrls] = useState([]);   // Array of {id, url, description} objects
  
  // Pending changes (only for editing mode)
  const [filesToAdd, setFilesToAdd] = useState([]);     // Array of {name, file, id} objects
  const [urlsToAdd, setUrlsToAdd] = useState([]);       // Array of {url, description, id} objects
  const [filesToDelete, setFilesToDelete] = useState([]); // Array of file names (strings)
  const [urlsToDelete, setUrlsToDelete] = useState([]);   // Array of document IDs (strings)
  const [deletedUrls, setDeletedUrls] = useState([]);     // ✅ NEW: Store full URL objects being deleted
  
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingDetails, setLoadingDetails] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);
  
  // URL form state
  const [newUrl, setNewUrl] = useState("");
  const [newUrlDescription, setNewUrlDescription] = useState("");
  const [editingBotName, setEditingBotName] = useState("");

  // Teams integration state
  const [teamsConnected, setTeamsConnected] = useState(false);

  // Ensures single load upon first opening
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  
  const auth = getAuth();
  const userId = auth.currentUser?.uid;

  useEffect(() => {
    if (!userId || !isOpen) return;

    if (isFirstLoad) {
      setIsFirstLoad(false);
      loadTeamsBotData();
    }
  }, [userId, isOpen]);

  const loadTeamsBotData = async () => {
    try {
      setLoading(true);
      
      // Get company name from user profile
      const userDoc = await getDoc(doc(db, 'users', userId, 'companyinfo', 'details'));
      if (userDoc.exists()) {
        const company = userDoc.data().companyName;
        
        // Check if company name exists
        if (!company || company.trim() === "") {
          alert("Error: Company name not found in your profile. Please ensure your company settings are complete.");
          onClose();
          return;
        }
        
        setCompanyName(company);
        
        // Load Teams Bot details
        const botDoc = await getDoc(doc(db, 'organizations', company, 'teamsBot', 'details'));
        if (botDoc.exists()) {
          const details = botDoc.data();
          setBotDetails(details);
          setEditingBotName(details.botName || `${company} Benefits Bot`);

          const hasTeamsIntegration = !!(details.tenantId && details.tenantDisplayName);
          setTeamsConnected(hasTeamsIntegration);
          
          // Load current files from files subcollection
          const filesSnapshot = await getDocs(collection(db, 'organizations', company, 'teamsBot', 'details', 'files'));
          const fileNames = filesSnapshot.docs.map(doc => doc.id);
          setCurrentFiles(fileNames);
          
          // Load current URLs from urls subcollection
          const urlsSnapshot = await getDocs(collection(db, 'organizations', company, 'teamsBot', 'details', 'urls'));
          const urls = urlsSnapshot.docs.map(doc => ({
            id: doc.id, 
            url: doc.data().url,   
            description: doc.data().description
          }));
          setCurrentUrls(urls);
        } else {
          // Initialize Teams Bot for this company
          await initializeTeamsBot(company);
        }
      } else {
        // User document doesn't exist
        alert("Error: User profile not found. Please try signing in again.");
        onClose();
        return;
      }
    } catch (error) {
      console.error("Error loading Teams Bot data:", error);
      alert("Error loading Teams Bot data. Please try again or contact support if the problem persists.");
      onClose();
      return;
    } finally {
      setLoading(false);
    }
  };

  // ✅ NEW: Teams OAuth Integration
  const handleTeamsSignIn = async () => {
    try {
      setLoading(true);
      setLoadingMessage("Connecting to Microsoft Teams");
      setLoadingDetails("Opening Microsoft authentication...");
      setLoadingProgress(10);
      
      // Microsoft Teams OAuth
      const provider = createMicrosoftProvider();
      
      setLoadingProgress(30);
      setLoadingDetails("Waiting for Microsoft authentication...");
      
      const result = await signInWithPopup(auth, provider);
      
      setLoadingProgress(60);
      setLoadingDetails("Extracting organization information...");
      
      // Get access token for Microsoft Graph API
      const accessToken = result._tokenResponse.oauthAccessToken;
      
      // Get organization info from Microsoft Graph
      const orgResponse = await fetch('https://graph.microsoft.com/v1.0/organization', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (!orgResponse.ok) {
        throw new Error('Failed to get organization information');
      }
      
      const orgData = await orgResponse.json();
      const organization = orgData.value[0];
      
      const tenantId = organization.id;
      const tenantDisplayName = organization.displayName;
      
      setLoadingProgress(80);
      setLoadingDetails("Configuring Teams integration...");
      
      // ✅ Store tenant information in Firebase
      await updateDoc(doc(db, 'organizations', companyName, 'teamsBot', 'details'), {
        tenantId: tenantId,
        tenantDisplayName: tenantDisplayName
      });
      
      setLoadingProgress(100);
      setLoadingDetails("Teams connection complete! 🎉");
      
      // Update local state
      setTeamsConnected(true);
      setBotDetails(prev => ({
        ...prev,
        tenantId: tenantId,
        tenantDisplayName: tenantDisplayName
      }));
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      alert(`Teams connected successfully!\n\nOrganization: ${tenantDisplayName}\n\nYou can now deploy your bot to Teams!`);
      
    } catch (error) {
      console.error('Teams authentication error:', error);
      
      let errorMessage = 'Failed to connect to Teams. ';
      if (error.code === 'auth/popup-closed-by-user') {
        errorMessage += 'Sign-in was cancelled.';
      } else if (error.code === 'auth/popup-blocked') {
        errorMessage += 'Popup was blocked. Please allow popups and try again.';
      } else if (error.message.includes('organization')) {
        errorMessage += 'Unable to access organization information. Please ensure you have admin permissions.';
      } else {
        errorMessage += 'Please try again or contact support.';
      }
      
      alert(errorMessage);
      
      setLoadingMessage("Connection Failed");
      setLoadingDetails("Please try again.");
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } finally {
      setLoading(false);
      setLoadingProgress(0);
      setLoadingMessage("");
      setLoadingDetails("");
    }
  };

  const initializeTeamsBot = async (company) => {
    const sanitizedCompanyName = company
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')  // Replace any non-alphanumeric with dash
      .replace(/-+/g, '-')         // Replace multiple dashes with single dash
      .replace(/^-|-$/g, '');      // Remove leading/trailing dashes
  
    const initialData = {
      deployed: false,
      botName: `${company} Benefits Bot`,
      azureSearchIndex: `${sanitizedCompanyName}-benefits-bot-index`,
      lastDeployment: null,
      tenantId: null,
      tenantDisplayName: null
    };
    
    await setDoc(doc(db, 'organizations', company, 'teamsBot', 'details'), initialData);
    setBotDetails(initialData);
    setEditingBotName(initialData.botName);
    setCurrentFiles([]);
    setCurrentUrls([]); 
  };

  // Determine if we're in editing mode (bot already deployed)
  const isEditingMode = botDetails.deployed;

  // Reset all pending changes
  const resetPendingChanges = () => {
    setFilesToAdd([]);
    setUrlsToAdd([]);
    setFilesToDelete([]);
    setUrlsToDelete([]);
    setDeletedUrls([]);
    setNewUrl("");
    setNewUrlDescription("");
  };

  // Helper function to check if there are any changes to discard
  const hasAnyChanges = () => {
    if (isEditingMode) {
      // In editing mode, check for pending changes
      return filesToAdd.length > 0 || urlsToAdd.length > 0 || filesToDelete.length > 0 || urlsToDelete.length > 0;
    } else {
      // In initial deployment mode, check pending additions
      return filesToAdd.length > 0 || urlsToAdd.length > 0;
    }
  };

  // Get cancel button text
  const getCancelButtonText = () => {
    if (hasAnyChanges()) {
      return "Discard Changes";
    } else {
      return "Cancel";
    }
  };

  // Check if a file can be added (considering delete queue)
  const canAddFile = (fileName) => {
    if (isEditingMode) {
      // In editing mode: complex logic for restore scenarios
      const existsInCurrent = currentFiles.includes(fileName);
      const existsInToAdd = filesToAdd.some(file => file.name === fileName);
      const isBeingDeleted = filesToDelete.includes(fileName);
      
      // Can add if:
      // 1. Doesn't exist in current files AND not already being added, OR
      // 2. Exists in current files but is being deleted AND not already being added
      if (!existsInCurrent && !existsInToAdd) {
        return true; // Completely new file
      }
      
      if (existsInCurrent && isBeingDeleted && !existsInToAdd) {
        return true; // Restoring a deleted file
      }
      
      return false; // All other cases are duplicates
    } else {
      // In initial deployment - simple check for duplicates in add queue only
      return !filesToAdd.some(file => file.name === fileName);
    }
  };

  // Check if a URL can be added (considering delete queue)
  const canAddUrl = (url) => {
    if (isEditingMode) {
      // In editing mode: complex logic for restore scenarios
      const existsInCurrent = currentUrls.some(urlItem => urlItem.url === url);
      const existsInToAdd = urlsToAdd.some(urlItem => urlItem.url === url);
      const isBeingDeleted = deletedUrls.some(deletedUrl => deletedUrl.url === url); // ✅ Check deletedUrls
      
      // Can add if:
      // 1. Doesn't exist in current URLs AND not already being added, OR
      // 2. Exists in deleted URLs (being restored) AND not already being added
      if (!existsInCurrent && !existsInToAdd && !isBeingDeleted) {
        return true; // Completely new URL
      }
      
      if (isBeingDeleted && !existsInToAdd) {
        return true; // Restoring a deleted URL
      }
      
      return false; // All other cases are duplicates
    } else {
      // In initial deployment - simple check for duplicates in add queue only
      return !urlsToAdd.some(urlItem => urlItem.url === url);
    }
  };
  
  // Check if a file can be restored from delete queue
  const canRestoreFile = (fileName) => {
    // Can restore if there's no duplicate in the add queue
    return !filesToAdd.some(file => file.name === fileName);
  };
  
  // Check if a URL can be restored from delete queue
  const canRestoreUrl = (url) => {
    // Can restore if there's no duplicate in the add queue
    return !urlsToAdd.some(urlItem => urlItem.url === url);
  };

  // Handle file upload with proper duplicate detection
  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    // Check for duplicates before processing
    const duplicateFiles = [];
    const validFiles = [];
    
    for (const file of files) {
      if (canAddFile(file.name)) {
        validFiles.push(file);
      } else {
        duplicateFiles.push(file.name);
      }
    }

    // Show duplicate warning if any
    if (duplicateFiles.length > 0) {
      alert(`The following files were not added because they already exist or are already being added: ${duplicateFiles.join(', ')}`);
    }

    // Reset the file input to allow re-uploading the same file
    event.target.value = '';

    if (validFiles.length === 0) return;

    const newFiles = validFiles.map(file => ({
      name: file.name,
      file: file,
      id: Date.now() + Math.random()
    }));

    // Always use filesToAdd for consistency
    setFilesToAdd(prev => [...prev, ...newFiles]);
  };

  const handleDeleteFile = (fileName) => {
    if (isEditingMode) {
      // In editing mode, check if it's an existing file or pending file
      const isExistingFile = currentFiles.includes(fileName);
      const isPendingFile = filesToAdd.some(file => file.name === fileName);
      
      if (isExistingFile) {
        // Move existing file to delete list
        setCurrentFiles(prev => prev.filter(name => name !== fileName));
        setFilesToDelete(prev => [...prev, fileName]);
      }
      
      if (isPendingFile) {
        // Remove from pending add list
        setFilesToAdd(prev => prev.filter(file => file.name !== fileName));
      }
    } else {
      // In initial deployment mode, just remove from pending add list
      setFilesToAdd(prev => prev.filter(file => file.name !== fileName));
    }
  };

  const handleAddUrl = () => {
    if (!newUrl || !newUrlDescription) {
      alert("Please enter both URL and description");
      return;
    }
    
    // Validate URL format
    try {
      new URL(newUrl);
    } catch {
      alert("Please enter a valid URL");
      return;
    }

    // Check for duplicates using canAddUrl
    if (!canAddUrl(newUrl)) {
      alert("This URL is already in your list or is already being added. Each URL can only be added once.");
      return;
    }

    const urlData = {
      url: newUrl,
      description: newUrlDescription,
      id: Date.now().toString()
    };

    setUrlsToAdd(prev => [...prev, urlData]);
    
    // Clear form
    setNewUrl("");
    setNewUrlDescription("");
  };

  // Handle URL deletion with proper state management
  const handleDeleteUrl = (url) => {
    if (isEditingMode) {
      // In editing mode, check if it's an existing URL or pending URL
      const existingUrl = currentUrls.find(u => u.url === url);
      const isPendingUrl = urlsToAdd.some(u => u.url === url);
      
      if (existingUrl) {
        // ✅ FIXED: Store the full URL object in deletedUrls for display
        setCurrentUrls(prev => prev.filter(u => u.url !== url));
        setUrlsToDelete(prev => [...prev, existingUrl.id]);
        setDeletedUrls(prev => [...prev, existingUrl]); // Store full object
      }
      
      if (isPendingUrl) {
        // Remove from pending add list
        setUrlsToAdd(prev => prev.filter(u => u.url !== url));
      }
    } else {
      // In initial deployment mode, just remove from pending add list
      setUrlsToAdd(prev => prev.filter(u => u.url !== url));
    }
  };

  // Handle cancel/discard changes
  const handleCancel = () => {
    if (hasAnyChanges()) {
      if (window.confirm("Discard all changes?")) {
        resetPendingChanges();
        if (isEditingMode) {
          loadTeamsBotData();
        }
        onClose();
      }
    } else {
      onClose();
    }
  };

  // handleDeployOrConfirm with Teams requirement
  const handleDeployOrConfirm = () => {
    if (isEditingMode) {
      // Check if there are any changes to confirm
      if (!hasAnyChanges()) {
        alert("No changes to apply.");
        return;
      }
      setShowConfirmation(true);
    } else {
      // Check Teams connection requirement for initial deployment
      if (!teamsConnected) {
        alert("Please sign in with Microsoft Teams before deploying your bot.\n\nThis connects your bot to your organization's Teams workspace.");
        return;
      }
      
      // Check if there's any content to deploy
      if (filesToAdd.length === 0 && urlsToAdd.length === 0) {
        alert("Please upload at least one document or add one URL before deploying");
        return;
      }
      setShowConfirmation(true);
    }
  };

  // Actual deployment logic
  const handleDeploy = async () => {
    setLoading(true);
    setLoadingProgress(0);
    
    try {
      const totalFiles = filesToAdd.length;
      
      if (isEditingMode) {
        setLoadingMessage("Updating Your Teams Bot");
        setLoadingDetails("Applying changes to your bot configuration...");
        setLoadingProgress(10);
        
        // Add slight delay to show the loading screen
        await new Promise(resolve => setTimeout(resolve, 500));
        
        setLoadingProgress(30);
        setLoadingDetails("Processing document changes...");
        
        const formData = new FormData();
        formData.append("companyName", companyName);
        
        for (const fileItem of filesToAdd) {
          if (fileItem.file) {
            formData.append('filesToAdd', fileItem.file);
          }
        }
        
        formData.append("filesToDelete", JSON.stringify(filesToDelete));
        formData.append("urlsToAdd", JSON.stringify(urlsToAdd));
        formData.append("urlsToDelete", JSON.stringify(urlsToDelete));
        
        setLoadingProgress(60);
        setLoadingDetails("Uploading changes to Azure Search...");
        
        const response = await axios.post(`${API_BASE_URL}/teams-bot/edit`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
          }
        });
        
        setLoadingProgress(90);
        setLoadingDetails("Finalizing bot updates...");
        
        if (response.data.success) {
          setLoadingProgress(100);
          setLoadingDetails("Bot updated successfully! 🎉");
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          resetPendingChanges();
          alert("Bot updated successfully!");
          await loadTeamsBotData();
        } else {
          throw new Error(response.data.error || "Unknown error occurred");
        }
        
      } else {
        // Enhanced initial deployment with Teams integration
        setLoadingMessage("Deploying Your Teams Bot");
        setLoadingDetails("Initializing deployment process...");
        setLoadingProgress(5);
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
        setLoadingProgress(15);
        setLoadingDetails("Creating Azure Search index...");
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
        setLoadingProgress(25);
        setLoadingDetails(`Processing ${totalFiles} document${totalFiles !== 1 ? 's' : ''}...`);
        
        const formData = new FormData();
        formData.append("companyName", companyName);
        formData.append("botName", editingBotName);
        
        // Include tenant information for bot routing
        if (botDetails.tenantId && botDetails.tenantDisplayName) {
          formData.append("tenantId", botDetails.tenantId);
          formData.append("tenantDisplayName", botDetails.tenantDisplayName);
        }
        
        for (const fileItem of filesToAdd) {
          if (fileItem.file) {
            formData.append('files', fileItem.file);
          }
        }
        
        formData.append("urls", JSON.stringify(urlsToAdd));
        
        setLoadingProgress(40);
        setLoadingDetails("Generating AI embeddings...");
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        setLoadingProgress(65);
        setLoadingDetails("Uploading content to Azure Search...");
        
        const response = await axios.post(`${API_BASE_URL}/teams-bot/deploy`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
          }
        });
        
        setLoadingProgress(85);
        setLoadingDetails("Configuring Teams integration...");
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
        if (response.data.success) {
          setLoadingProgress(100);
          setLoadingDetails("Bot deployed to Teams! 🚀");
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          resetPendingChanges();
          alert(`Bot deployed successfully to Teams!\n\nOrganization: ${botDetails.tenantDisplayName}\nIndex: ${response.data.indexName}\nContent: ${response.data.contentCount} items`);
          await loadTeamsBotData();
        } else {
          throw new Error(response.data.error || "Unknown error occurred");
        }
      }
      
    } catch (error) {
      console.error("Error deploying bot:", error);
      setLoadingMessage("Deployment Failed");
      setLoadingDetails("An error occurred. Please try again.");
      setLoadingProgress(0);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      alert(`Error ${isEditingMode ? 'updating' : 'deploying'} bot. Please try again.`);
    } finally {
      setLoading(false);
      setShowConfirmation(false);
      setLoadingMessage("");
      setLoadingDetails("");
      setLoadingProgress(0);
    }
  };

  if (!isOpen) return null;

  if (loading) {
    return (
      <LoadingAnimation 
        message={loadingMessage || "Loading..."}
        progress={loadingProgress}
        details={loadingDetails}
      />
    );
  }

  return (
    <div className="teams-bot-overlay">
      <div className="teams-bot-container">
        <button onClick={onClose} className="teams-bot-close">✖</button>
        
        <div className="teams-bot-header">
          <h2 className="teams-bot-title">Microsoft Teams Chat Bot Config</h2>
          {botDetails.deployed && (
            <p style={{color: 'green', margin: '5px 0 0 0', fontSize: '14px'}}>
              ✅ Bot Deployed - Last: {
                botDetails.lastDeployment 
                  ? (botDetails.lastDeployment.toDate ? 
                      botDetails.lastDeployment.toDate().toLocaleString() : 
                      new Date(botDetails.lastDeployment).toLocaleString()
                    )
                  : 'Unknown'
              }
            </p>
          )}
        </div>

        <div className="teams-bot-content">
          {/* Upload Section */}
          <div className={`teams-bot-section ${uploadSectionExpanded ? 'expanded' : ''}`}>
            <div className="teams-bot-section-content">
              <div 
                className="teams-bot-integrated-header"
                onClick={() => setUploadSectionExpanded(!uploadSectionExpanded)}
              >
                <span className="teams-bot-expand-icon">
                  {uploadSectionExpanded ? "▼" : "▶"}
                </span>
                <h3 className="teams-bot-section-title">Upload Benefits Info Files</h3>
              </div>
              
              {uploadSectionExpanded && (
                <div className="teams-bot-section-body">
                  <div className="teams-bot-file-upload">
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.docx"
                      className="teams-bot-file-input"
                      onChange={handleFileUpload}
                      disabled={loading}
                    />
                  </div>
                  
                  {/* Existing Files (Editing Mode Only) */}
                  {isEditingMode && currentFiles.length > 0 && (
                    <div className="teams-bot-files-section">
                      <h4>Existing Files ({currentFiles.length}):</h4>
                      <div className="teams-bot-file-list">
                        {currentFiles.map((fileName, index) => (
                          <div key={`existing-${index}-${fileName}`} className="teams-bot-file-item">
                            <div className="teams-bot-file-row">
                              <span className="teams-bot-file-link">{fileName}</span>
                              <button 
                                className="teams-bot-action-button teams-bot-delete-button"
                                onClick={() => handleDeleteFile(fileName)}
                                disabled={loading}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Files to Add (Both Modes) */}
                  {filesToAdd.length > 0 && (
                    <div className="teams-bot-files-section">
                      <h4>{isEditingMode ? "Files to Add" : "Files"} ({filesToAdd.length}):</h4>
                      <div className="teams-bot-file-list">
                        {filesToAdd.map(file => (
                          <div key={file.id} className="teams-bot-file-item">
                            <div className="teams-bot-file-row">
                              <span className="teams-bot-file-link" style={{color: 'green'}}>
                                {file.name}
                                {!isEditingMode && ' (new)'}
                              </span>
                              <button 
                                className="teams-bot-action-button teams-bot-delete-button"
                                onClick={() => handleDeleteFile(file.name)}
                                disabled={loading}
                              >
                                {isEditingMode ? "Remove" : "Delete"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Files to Delete (Editing Mode Only) */}
                  {isEditingMode && filesToDelete.length > 0 && (
                    <div className="teams-bot-files-section">
                      <h4>Files to Delete ({filesToDelete.length}):</h4>
                      <div className="teams-bot-file-list">
                        {filesToDelete.map(fileName => (
                          <div key={`delete-${fileName}`} className="teams-bot-file-item">
                            <div className="teams-bot-file-row">
                              <span className="teams-bot-file-link" style={{color: 'red', textDecoration: 'line-through'}}>{fileName}</span>
                              <button 
                                className="teams-bot-action-button teams-bot-edit-button"
                                onClick={() => {
                                  setFilesToDelete(prev => prev.filter(name => name !== fileName));
                                  setCurrentFiles(prev => [...prev, fileName]);
                                }}
                                disabled={loading || !canRestoreFile(fileName)}
                                title={!canRestoreFile(fileName) ? "Cannot restore: A file with this name is being added" : ""}
                              >
                                Restore
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* URLs Section */}
          <div className={`teams-bot-section ${linksSectionExpanded ? 'expanded' : ''}`}>
            <div className="teams-bot-section-content">
              <div 
                className="teams-bot-integrated-header"
                onClick={() => setLinksSectionExpanded(!linksSectionExpanded)}
              >
                <span className="teams-bot-expand-icon">
                  {linksSectionExpanded ? "▼" : "▶"}
                </span>
                <h3 className="teams-bot-section-title">Add Links To Resources</h3>
              </div>
              
              {linksSectionExpanded && (
                <div className="teams-bot-section-body">
                  <div className="teams-bot-url-form">
                    <div className="teams-bot-form-group">
                      <label className="teams-bot-label">URL:</label>
                      <input
                        type="url"
                        placeholder="https://example.com"
                        className="teams-bot-input"
                        value={newUrl}
                        onChange={(e) => setNewUrl(e.target.value)}
                        disabled={loading}
                      />
                    </div>
                    <div className="teams-bot-form-group">
                      <label className="teams-bot-label">Description:</label>
                      <textarea
                        placeholder="Concise description of this resource"
                        className="teams-bot-input teams-bot-textarea"
                        value={newUrlDescription}
                        onChange={(e) => setNewUrlDescription(e.target.value)}
                        disabled={loading}
                        rows={2}
                      />
                    </div>
                    <button 
                      className="teams-bot-button"
                      onClick={handleAddUrl}
                      disabled={loading || !newUrl || !newUrlDescription}
                    >
                      Add Link
                    </button>
                  </div>

                  {/* Existing URLs (Editing Mode Only) */}
                  {isEditingMode && currentUrls.length > 0 && (
                    <div className="teams-bot-links-section">
                      <h4>Existing URLs ({currentUrls.length}):</h4>
                      <div className="teams-bot-url-list">
                        {currentUrls.map(link => (
                          <div key={`existing-${link.url}`} className="teams-bot-url-item">
                            <div className="teams-bot-url-field">
                              <strong>URL:</strong> 
                              <a 
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="teams-bot-url-link"
                              >
                                {link.url}
                              </a>
                            </div>
                            <div className="teams-bot-url-field">
                              <strong>Description:</strong>
                              <div className="teams-bot-url-description">
                                {link.description}
                              </div>
                            </div>
                            <div className="teams-bot-url-actions">
                              <button 
                                className="teams-bot-action-button teams-bot-delete-button"
                                onClick={() => handleDeleteUrl(link.url)}
                                disabled={loading}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* URLs to Add (Both Modes) */}
                  {urlsToAdd.length > 0 && (
                    <div className="teams-bot-links-section">
                      <h4>{isEditingMode ? "URLs to Add" : "URLs"} ({urlsToAdd.length}):</h4>
                      <div className="teams-bot-url-list">
                        {urlsToAdd.map(link => (
                          <div key={link.id} className="teams-bot-url-item">
                            <div className="teams-bot-url-field">
                              <strong>URL:</strong> 
                              <a 
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="teams-bot-url-link"
                                style={{color: 'green'}}
                              >
                                {link.url}
                              </a>
                              {!isEditingMode && <span style={{color: 'green'}}> (new)</span>}
                            </div>
                            <div className="teams-bot-url-field">
                              <strong>Description:</strong>
                              <div className="teams-bot-url-description" style={{color: 'green'}}>
                                {link.description}
                              </div>
                            </div>
                            <div className="teams-bot-url-actions">
                              <button 
                                className="teams-bot-action-button teams-bot-delete-button"
                                onClick={() => handleDeleteUrl(link.url)}
                                disabled={loading}
                              >
                                {isEditingMode ? "Remove" : "Delete"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ✅ FIXED: URLs to Delete (Editing Mode Only) - Now uses deletedUrls */}
                  {isEditingMode && urlsToDelete.length > 0 && (
                    <div className="teams-bot-links-section">
                      <h4>URLs to Delete ({urlsToDelete.length}):</h4>
                      <div className="teams-bot-url-list">
                        {deletedUrls.map(urlObj => (
                          <div key={`delete-${urlObj.id}`} className="teams-bot-url-item">
                            <div className="teams-bot-url-field">
                              <strong>URL:</strong> 
                              <span style={{color: 'red', textDecoration: 'line-through'}}>{urlObj.url}</span>
                            </div>
                            <div className="teams-bot-url-field">
                              <strong>Description:</strong>
                              <div className="teams-bot-url-description" style={{color: 'red', textDecoration: 'line-through'}}>
                                {urlObj.description}
                              </div>
                            </div>
                            <div className="teams-bot-url-actions">
                              <button 
                                className="teams-bot-action-button teams-bot-edit-button"
                                onClick={() => {
                                  // ✅ FIXED: Restore from deletedUrls array
                                  setUrlsToDelete(prev => prev.filter(id => id !== urlObj.id));
                                  setDeletedUrls(prev => prev.filter(u => u.id !== urlObj.id));
                                  setCurrentUrls(prev => [...prev, urlObj]);
                                }}
                                disabled={loading || !canRestoreUrl(urlObj.url)}
                                title={!canRestoreUrl(urlObj.url) ? "Cannot restore: A URL with this address is being added" : ""}
                              >
                                Restore
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="teams-bot-footer">
          {!teamsConnected ? (
            <button 
              className="teams-bot-auth-button"
              onClick={handleTeamsSignIn}
              disabled={loading}
              title="Connect to Microsoft Teams (Required for deployment)"
            >
              <i className="fab fa-microsoft teams-bot-auth-icon"></i>
              Sign in with Teams
            </button>
          ) : (
            <div className="teams-bot-auth-connected">
              <button 
                className="teams-bot-auth-button teams-bot-connected"
                disabled
                title={`Connected to: ${botDetails.tenantDisplayName}`}
              >
                <i className="fab fa-microsoft teams-bot-auth-icon"></i>
                ✅ Connected: {botDetails.tenantDisplayName}
              </button>
              <div className="teams-bot-tenant-info">
                <small>
                  Organization: {botDetails.tenantDisplayName}
                </small>
              </div>
            </div>
          )}
          
          <div className="teams-bot-footer-actions">
            <button 
              onClick={handleCancel}
              className="teams-bot-cancel-button"
            >
              {getCancelButtonText()}
            </button>
            <button 
              className="teams-bot-deploy-button"
              onClick={handleDeployOrConfirm}
              disabled={loading || (!isEditingMode && !teamsConnected) || !hasAnyChanges()}
              title={!teamsConnected && !isEditingMode ? "Please sign in with Teams first" : ""}
            >
              {loading ? "Processing..." : isEditingMode ? "Confirm" : "Deploy Bot"}
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmation && (
        <div className="teams-bot-overlay teams-bot-confirmation-overlay" style={{zIndex: 10001}}>
          <div className="teams-bot-container" style={{
            maxWidth: '450px', 
            padding: '20px',
            maxHeight: '85vh',
            overflow: 'auto'
          }}>
            
            {/* Compact Header */}
            <div style={{textAlign: 'center', marginBottom: '15px'}}>
              <div style={{fontSize: '32px', marginBottom: '10px'}}>
                {isEditingMode ? "⚙️" : "🚀"}
              </div>
              <h3 style={{margin: '0 0 4px 0', fontSize: '22px', color: '#333'}}>
                {isEditingMode ? "Confirm Changes" : "Deploy Teams Bot"}
              </h3>
              <p style={{margin: 0, color: '#666', fontSize: '14px'}}>
                {isEditingMode 
                  ? "Review and confirm the changes to your bot"
                  : "Ready to deploy your chatbot to Microsoft Teams"
                }
              </p>
            </div>
      
            {/* Bot Name Section (Initial deployment only)  */}
            {!isEditingMode && (
              <div style={{
                margin: '5px 0 5px 0', 
                padding: '12px', 
                backgroundColor: '#f8f9fa', 
                borderRadius: '8px',
                border: '1px solid #e9ecef'
              }}>
                <label style={{
                  display: 'block', 
                  marginBottom: '6px', 
                  fontWeight: 'bold',
                  color: '#333',
                  fontSize: '14px'
                }}>
                  Bot Name in Teams:
                </label>
                <input
                  type="text"
                  value={editingBotName}
                  onChange={(e) => setEditingBotName(e.target.value)}
                  className="teams-bot-input"
                  style={{
                    width: '100%', 
                    marginBottom: '6px',
                    padding: '8px 12px',
                    fontSize: '14px'
                  }}
                  placeholder="Enter bot name"
                  disabled={loading}
                />
                <p style={{
                  margin: 0, 
                  fontSize: '12px', 
                  color: '#6c757d',
                  fontStyle: 'italic'
                }}>
                  💡 This is the name users will see when chatting with your bot in Microsoft Teams
                </p>
              </div>
            )}
      
            {/* Current Bot Name */}
            {isEditingMode && (
              <div style={{
                margin: '5px 0 5px 0', 
                padding: '10px', 
                backgroundColor: '#f8f9fa', 
                borderRadius: '8px',
                border: '1px solid #e9ecef',
                textAlign: 'center'
              }}>
                <p style={{margin: 0, fontSize: '14px', color: '#666'}}>
                  <strong style={{color: '#333'}}>Bot Name:</strong> {botDetails.botName}
                </p>
              </div>
            )}
      
            {/* Changes Summary */}
            <div style={{
              margin: '12px 0', 
              padding: '12px', 
              backgroundColor: '#fff', 
              borderRadius: '8px',
              border: '1px solid #dee2e6'
            }}>
              <h4 style={{
                margin: '0 0 8px 0', 
                fontSize: '16px', 
                color: '#333',
                textAlign: 'center'
              }}>
                {isEditingMode ? "Changes to Apply:" : "Content to Deploy:"}
              </h4>
              
              <div style={{fontSize: '14px', lineHeight: '1.3'}}>
                {!isEditingMode ? (
                  // Initial deployment summary
                  <>
                    {filesToAdd.length > 0 && (
                      <div style={{display: 'flex', alignItems: 'center', marginBottom: '5px'}}>
                        <span style={{marginRight: '6px', fontSize: '16px'}}>📄</span>
                        <span>Deploy <strong>{filesToAdd.length}</strong> document{filesToAdd.length !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {urlsToAdd.length > 0 && (
                      <div style={{display: 'flex', alignItems: 'center', marginBottom: '5px'}}>
                        <span style={{marginRight: '6px', fontSize: '16px'}}>🔗</span>
                        <span>Add <strong>{urlsToAdd.length}</strong> URL{urlsToAdd.length !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {filesToAdd.length === 0 && urlsToAdd.length === 0 && (
                      <p style={{margin: 0, color: '#6c757d', textAlign: 'center', fontStyle: 'italic'}}>
                        No content to deploy
                      </p>
                    )}
                  </>
                ) : (
                  // Editing mode summary
                  <>
                    {filesToAdd.length > 0 && (
                      <div style={{display: 'flex', alignItems: 'center', marginBottom: '5px', color: '#28a745'}}>
                        <span style={{marginRight: '6px', fontSize: '16px'}}>➕</span>
                        <span>Add <strong>{filesToAdd.length}</strong> new file{filesToAdd.length !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {urlsToAdd.length > 0 && (
                      <div style={{display: 'flex', alignItems: 'center', marginBottom: '5px', color: '#28a745'}}>
                        <span style={{marginRight: '6px', fontSize: '16px'}}>➕</span>
                        <span>Add <strong>{urlsToAdd.length}</strong> new URL{urlsToAdd.length !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {filesToDelete.length > 0 && (
                      <div style={{display: 'flex', alignItems: 'center', marginBottom: '5px', color: '#dc3545'}}>
                        <span style={{marginRight: '6px', fontSize: '16px'}}>➖</span>
                        <span>Delete <strong>{filesToDelete.length}</strong> file{filesToDelete.length !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {urlsToDelete.length > 0 && (
                      <div style={{display: 'flex', alignItems: 'center', marginBottom: '5px', color: '#dc3545'}}>
                        <span style={{marginRight: '6px', fontSize: '16px'}}>➖</span>
                        <span>Delete <strong>{urlsToDelete.length}</strong> URL{urlsToDelete.length !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {!hasAnyChanges() && (
                      <p style={{margin: 0, color: '#6c757d', textAlign: 'center', fontStyle: 'italic'}}>
                        No changes to apply
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
      
            {/* Warning for initial deployment - Reduced Spacing */}
            {!isEditingMode && (
              <div style={{
                margin: '5px 0', 
                padding: '10px 12px', 
                backgroundColor: '#fff3cd', 
                borderRadius: '6px',
                border: '1px solid #ffeaa7',
                fontSize: '13px',
                color: '#856404'
              }}>
                <div style={{display: 'flex', alignItems: 'flex-start'}}>
                  <span style={{marginRight: '6px', fontSize: '16px'}}>⚠️</span>
                  <span>
                    Once deployed, this bot will be available to all members of your organization in Microsoft Teams.
                  </span>
                </div>
              </div>
            )}
            
            {/* Action Buttons - Reduced Top Margin */}
            <div className="teams-bot-footer-actions" style={{marginTop: '5px', gap: '12px'}}>
              <button 
                onClick={() => setShowConfirmation(false)}
                className="teams-bot-cancel-button"
                style={{flex: 1}}
              >
                Cancel
              </button>
              <button 
                onClick={handleDeploy}
                className="teams-bot-deploy-button"
                disabled={loading || (!isEditingMode && !editingBotName.trim())}
                style={{flex: 1}}
              >
                {loading 
                  ? (isEditingMode ? "Applying..." : "Deploying...") 
                  : (isEditingMode ? "Apply Changes" : "Deploy Bot")
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamsBot;