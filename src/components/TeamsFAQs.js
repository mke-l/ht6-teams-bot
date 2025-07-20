import React, { useState, useEffect } from "react";
import Draggable from "react-draggable";
import { ResizableBox } from "react-resizable";
import "react-resizable/css/styles.css";

const TeamsFAQs = ({ onClose, zIndex = 999, onFocus }) => {
  // Viewport dimensions state
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [resizableKey, setResizableKey] = useState(0);

  // Track current position and size
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [popupSize, setPopupSize] = useState({ width: 300, height: 600 }); // Track actual size

  // Hardcoded FAQ data - top 10 most frequently asked questions
  const faqData = [
    { question: "How do I enroll in health benefits?", count: 127 },
    { question: "What is my HSA contribution limit?", count: 98 },
    { question: "How do I add a dependent to my plan?", count: 87 },
    { question: "What is covered under my dental plan?", count: 76 },
    { question: "How do I find a network provider?", count: 65 },
    { question: "What is the difference between HMO and PPO?", count: 58 },
    { question: "How do I submit a claim for reimbursement?", count: 52 },
    { question: "What is my 401k match?", count: 47 },
    { question: "How do I access my EAP benefits?", count: 41 },
    { question: "What happens to my benefits if I take leave?", count: 38 }
  ];

/*========*/
/* Render */
/*========*/

  // Calculate dynamic bounds to prevent dragging below viewport
  const getDragBounds = () => {
    return {
      left: 0,
      top: 0,
      right: Math.max(0, viewportWidth - popupSize.width),
      bottom: Math.max(0, viewportHeight - popupSize.height - 60) // -60 for navbar
    };
  };

  // Update viewport dimensions on window resize and reposition elements that would have been cut off
  useEffect(() => {
    const handleResize = () => {
      const newViewportHeight = window.innerHeight;
      const newViewportWidth = window.innerWidth;
      
      setViewportHeight(newViewportHeight);
      setViewportWidth(newViewportWidth);
      setResizableKey(prev => prev + 1);

      // Reposition if popup would be cut off - using actual popup dimensions
      setPosition(prevPos => ({
        x: Math.min(prevPos.x, Math.max(0, newViewportWidth - popupSize.width)),
        y: Math.min(prevPos.y, Math.max(0, newViewportHeight - popupSize.height - 60)) // -60 for navbar
      }));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [popupSize.width, popupSize.height]); // Add popupSize as dependency

  const handleDrag = (e, data) => {
    setPosition({ x: data.x, y: data.y }); // Track position
  };

  // Handle resize events to track popup size
  const handlePopupResize = (event, { size }) => {
    setPopupSize({ width: size.width, height: size.height });
  };

  return (
    <div
      style={{
        position: "fixed",
        top: "60px",
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: zIndex, // Use passed zIndex
        pointerEvents: "none",
      }}
      onMouseDown={onFocus} // Bring to front when clicked
    >
      <Draggable
        handle=".teams-faqs-header"
        bounds={getDragBounds()} // Use calculated bounds instead of "parent"
        defaultPosition={{ x: 0, y: 0 }}
        position={position}
        onStart={onFocus} // Bring to front when dragging starts
        onDrag={handleDrag}
      >
        <ResizableBox
          key={resizableKey}
          width={popupSize.width} // Use tracked width instead of hardcoded 300
          height={Math.min(popupSize.height, viewportHeight - 60)} // Use tracked height
          minConstraints={[300, 300]}
          maxConstraints={[viewportWidth, viewportHeight - 60 - position.y]} // Use dynamic height
          resizeHandles={["se"]}
          onResize={handlePopupResize} // Track size changes
          style={{ position: "absolute", pointerEvents: "auto" }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              position: "relative",
              backgroundColor: "#fefefe",
              border: "2px solid #ccc",
              borderRadius: "10px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              className="teams-faqs-header"
              style={{
                padding: "10px",
                background: "linear-gradient(120deg, #007bff, #00aaff)",
                color: "white",
                cursor: "move",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexShrink: 0,
                borderTopLeftRadius: "10px",
                borderTopRightRadius: "10px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <i className="fa-solid fa-comments" style={{ fontSize: "18px" }}></i>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600" }}>
                  Teams FAQs
                </h3>
              </div>
              <button
                onClick={onClose}
                aria-label="Close FAQ modal"
                style={{
                  background: "none",
                  border: "none",
                  color: "white",
                  fontSize: "16px",
                  cursor: "pointer",
                  padding: "4px",
                }}
              >
                ✖
              </button>
            </div>

            {/* Subtitle */}
            <div
              style={{
                padding: "10px",
                backgroundColor: "#fafafa",
                borderBottom: "1px solid #ddd",
                flexShrink: 0,
              }}
            >
              <p style={{ 
                margin: 0, 
                fontSize: "14px", 
                color: "#666",
                lineHeight: "1.3"
              }}>
                10 most frequent questions for Teams Bot
              </p>
            </div>

            {/* Content */}
            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "10px",
                backgroundColor: "#fefefe",
              }}
            >
              <div
                style={{
                  backgroundColor: "white",
                  border: "1px solid #ddd",
                  borderRadius: "6px",
                  padding: "8px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "14px",
                  }}
                >
                  <thead>
                    <tr>
                      <th
                        style={{
                          padding: "10px 12px",
                          textAlign: "left",
                          fontWeight: "600",
                          color: "#555",
                          borderBottom: "1px solid #ddd",
                          backgroundColor: "#fafafa",
                          fontSize: "14px",
                        }}
                      >
                        Question
                      </th>
                      <th
                        style={{
                          padding: "10px 12px",
                          textAlign: "right",
                          fontWeight: "600",
                          color: "#555",
                          borderBottom: "1px solid #ddd",
                          backgroundColor: "#fafafa",
                          width: "70px",
                          fontSize: "14px",
                        }}
                      >
                        Count
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {faqData.map((faq, index) => (
                      <tr 
                        key={index}
                        style={{
                          transition: "background-color 0.2s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = "#f5f5f5";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "transparent";
                        }}
                      >
                        <td
                          style={{
                            padding: "10px 12px",
                            borderBottom: index < faqData.length - 1 ? "1px solid #ececec" : "none",
                            color: "#555",
                            lineHeight: "1.3",
                          }}
                        >
                          {faq.question}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            borderBottom: index < faqData.length - 1 ? "1px solid #ececec" : "none",
                            color: "#555",
                            fontWeight: "600",
                          }}
                        >
                          {faq.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </ResizableBox>
      </Draggable>
    </div>
  );
};

export default TeamsFAQs;