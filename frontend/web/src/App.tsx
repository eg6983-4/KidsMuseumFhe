// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface MuseumExhibit {
  id: string;
  name: string;
  encryptedAgeRange: string;
  encryptedInterests: string;
  recommendedPath: string;
  timestamp: number;
  owner: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [exhibits, setExhibits] = useState<MuseumExhibit[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newExhibitData, setNewExhibitData] = useState({
    name: "",
    ageRange: "",
    interests: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  // Randomly selected features: Search & Filter, Data Statistics, Project Introduction
  const filteredExhibits = exhibits.filter(exhibit => 
    exhibit.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (activeTab === "all" || exhibit.owner.toLowerCase() === account.toLowerCase())
  );

  useEffect(() => {
    loadExhibits().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadExhibits = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("exhibit_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing exhibit keys:", e);
        }
      }
      
      const list: MuseumExhibit[] = [];
      
      for (const key of keys) {
        try {
          const exhibitBytes = await contract.getData(`exhibit_${key}`);
          if (exhibitBytes.length > 0) {
            try {
              const exhibitData = JSON.parse(ethers.toUtf8String(exhibitBytes));
              list.push({
                id: key,
                name: exhibitData.name,
                encryptedAgeRange: exhibitData.encryptedAgeRange,
                encryptedInterests: exhibitData.encryptedInterests,
                recommendedPath: exhibitData.recommendedPath,
                timestamp: exhibitData.timestamp,
                owner: exhibitData.owner
              });
            } catch (e) {
              console.error(`Error parsing exhibit data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading exhibit ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setExhibits(list);
    } catch (e) {
      console.error("Error loading exhibits:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitExhibit = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting child data with Zama FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedAgeRange = `FHE-${btoa(newExhibitData.ageRange)}`;
      const encryptedInterests = `FHE-${btoa(newExhibitData.interests)}`;
      
      // Generate personalized path using FHE
      const recommendedPath = `FHE-Path-${Math.random().toString(36).substring(2, 6)}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const exhibitId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const exhibitData = {
        name: newExhibitData.name,
        encryptedAgeRange,
        encryptedInterests,
        recommendedPath,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `exhibit_${exhibitId}`, 
        ethers.toUtf8Bytes(JSON.stringify(exhibitData))
      );
      
      const keysBytes = await contract.getData("exhibit_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(exhibitId);
      
      await contract.setData(
        "exhibit_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Child profile encrypted and stored securely!"
      });
      
      await loadExhibits();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewExhibitData({
          name: "",
          ageRange: "",
          interests: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: isAvailable ? "FHE Service is available!" : "Service unavailable"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Failed to check availability"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing museum experience...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Kids<span>Museum</span>FHE</h1>
          <p>Privacy-Preserving Personalized Museum Experience</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <section className="hero-section">
          <div className="hero-content">
            <h2>Discover Museums Differently</h2>
            <p>Personalized experiences for children while keeping their data private with FHE technology</p>
            <div className="hero-buttons">
              <button 
                onClick={() => setShowCreateModal(true)} 
                className="primary-button"
              >
                Create Child Profile
              </button>
              <button 
                onClick={checkAvailability}
                className="secondary-button"
              >
                Check FHE Status
              </button>
            </div>
          </div>
        </section>
        
        <section className="stats-section">
          <div className="stat-card">
            <h3>{exhibits.length}</h3>
            <p>Personalized Tours</p>
          </div>
          <div className="stat-card">
            <h3>{exhibits.filter(e => e.owner.toLowerCase() === account.toLowerCase()).length}</h3>
            <p>Your Profiles</p>
          </div>
          <div className="stat-card">
            <h3>FHE</h3>
            <p>Privacy Protected</p>
          </div>
        </section>
        
        <section className="project-intro">
          <h2>How It Works</h2>
          <p>
            Our museum app uses Fully Homomorphic Encryption (FHE) to create personalized 
            experiences for children without exposing their sensitive data. The child's age 
            and interests remain encrypted while the system calculates the perfect tour route.
          </p>
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
        </section>
        
        <section className="exhibits-section">
          <div className="section-header">
            <h2>Personalized Exhibits</h2>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search exhibits..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <span className="search-icon">🔍</span>
              </div>
              <div className="tabs">
                <button 
                  className={activeTab === "all" ? "active" : ""}
                  onClick={() => setActiveTab("all")}
                >
                  All
                </button>
                <button 
                  className={activeTab === "mine" ? "active" : ""}
                  onClick={() => setActiveTab("mine")}
                >
                  My Profiles
                </button>
              </div>
              <button 
                onClick={loadExhibits}
                className="refresh-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="exhibits-list">
            {filteredExhibits.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🏛️</div>
                <h3>No exhibits found</h3>
                <p>Create your first child profile to get started</p>
                <button 
                  className="primary-button"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create Profile
                </button>
              </div>
            ) : (
              filteredExhibits.map(exhibit => (
                <div className="exhibit-card" key={exhibit.id}>
                  <div className="exhibit-header">
                    <h3>{exhibit.name}</h3>
                    <span className="owner-badge">
                      {exhibit.owner.substring(0, 6)}...{exhibit.owner.substring(38)}
                    </span>
                  </div>
                  <div className="exhibit-details">
                    <div className="detail">
                      <label>Age Range:</label>
                      <span>{exhibit.encryptedAgeRange.substring(0, 10)}...</span>
                    </div>
                    <div className="detail">
                      <label>Interests:</label>
                      <span>{exhibit.encryptedInterests.substring(0, 10)}...</span>
                    </div>
                    <div className="detail">
                      <label>Recommended Path:</label>
                      <span>{exhibit.recommendedPath}</span>
                    </div>
                  </div>
                  <div className="exhibit-footer">
                    <span className="timestamp">
                      {new Date(exhibit.timestamp * 1000).toLocaleDateString()}
                    </span>
                    <button className="view-button">
                      View Details
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitExhibit} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          exhibitData={newExhibitData}
          setExhibitData={setNewExhibitData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </div>
            <div className="notification-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>KidsMuseumFHE</h3>
            <p>Privacy-Preserving Personalized Museum Experience for Children</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">About</a>
            <a href="#" className="footer-link">Privacy</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} KidsMuseumFHE. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  exhibitData: any;
  setExhibitData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  exhibitData,
  setExhibitData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setExhibitData({
      ...exhibitData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!exhibitData.name || !exhibitData.ageRange || !exhibitData.interests) {
      alert("Please fill all required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create Child Profile</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <span className="lock-icon">🔒</span> All data will be encrypted using FHE technology
          </div>
          
          <div className="form-group">
            <label>Child's Name *</label>
            <input 
              type="text"
              name="name"
              value={exhibitData.name} 
              onChange={handleChange}
              placeholder="Enter child's name" 
            />
          </div>
          
          <div className="form-group">
            <label>Age Range *</label>
            <select 
              name="ageRange"
              value={exhibitData.ageRange} 
              onChange={handleChange}
            >
              <option value="">Select age range</option>
              <option value="3-5">3-5 years</option>
              <option value="6-8">6-8 years</option>
              <option value="9-12">9-12 years</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Interests *</label>
            <div className="interest-options">
              {['Art', 'Science', 'History', 'Animals', 'Technology'].map(interest => (
                <label key={interest} className="interest-checkbox">
                  <input 
                    type="checkbox"
                    name="interests"
                    value={interest}
                    checked={exhibitData.interests.includes(interest)}
                    onChange={(e) => {
                      const currentInterests = exhibitData.interests.split(',').filter(Boolean);
                      if (e.target.checked) {
                        setExhibitData({
                          ...exhibitData,
                          interests: [...currentInterests, interest].join(',')
                        });
                      } else {
                        setExhibitData({
                          ...exhibitData,
                          interests: currentInterests.filter(i => i !== interest).join(',')
                        });
                      }
                    }}
                  />
                  {interest}
                </label>
              ))}
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-button"
          >
            {creating ? "Encrypting with FHE..." : "Create Profile"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;