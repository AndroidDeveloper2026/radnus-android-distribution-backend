// src/pages/Invoice/InvoicePage.js

import React, { useRef, useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import html2pdf from "html2pdf.js";
import { useTheme } from "../../context/ThemeContext";
import { Printer, FileText } from "lucide-react";
import radnusLogo from "../../assets/logo/radnus-logo.png";
import "./InvoicePage.css";

const S = {
  wrap: {
    background: "#ffffff",
    color: "#000000",
    WebkitTextFillColor: "#000000",
  },
  text: {
    color: "#000000",
    WebkitTextFillColor: "#000000",
    background: "transparent",
  },
  tdWhite: {
    border: "1px solid #000",
    padding: "0.3rem 0.35rem",
    background: "#ffffff",
    color: "#000000",
    WebkitTextFillColor: "#000000",
    verticalAlign: "middle",
    fontSize: "0.75rem",
  },
  tdGrey: {
    border: "1px solid #000",
    padding: "0.3rem 0.35rem",
    background: "#f5f5f5",
    color: "#000000",
    WebkitTextFillColor: "#000000",
    verticalAlign: "middle",
    fontSize: "0.75rem",
  },
  tdTotal: {
    border: "1px solid #000",
    padding: "0.3rem 0.35rem",
    background: "#e8e8e8",
    color: "#000000",
    WebkitTextFillColor: "#000000",
    fontWeight: "700",
    verticalAlign: "middle",
    fontSize: "0.75rem",
    borderTop: "2px solid #000",
  },
  th: {
    border: "1px solid #000",
    padding: "0.45rem 0.4rem",
    background: "#f0f0f0",
    color: "#000000",
    WebkitTextFillColor: "#000000",
    fontWeight: "800",
    textTransform: "uppercase",
    fontSize: "0.72rem",
    letterSpacing: "0.6px",
    textAlign: "left",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  },
  metaTd: {
    border: "1px solid #000",
    padding: "0.25rem 0.35rem",
    background: "#ffffff",
    color: "#000000",
    WebkitTextFillColor: "#000000",
    fontSize: "0.75rem",
  },
};

const amountInWords = (num) => {
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];
  if (num === 0) return "Zero";
  if (num < 20) return ones[num];
  if (num < 100)
    return tens[Math.floor(num / 10)] + (num % 10 ? " " + ones[num % 10] : "");
  if (num < 1000)
    return (
      ones[Math.floor(num / 100)] +
      " Hundred" +
      (num % 100 ? " " + amountInWords(num % 100) : "")
    );
  if (num < 100000)
    return (
      amountInWords(Math.floor(num / 1000)) +
      " Thousand" +
      (num % 1000 ? " " + amountInWords(num % 1000) : "")
    );
  return (
    amountInWords(Math.floor(num / 100000)) +
    " Lakh" +
    (num % 100000 ? " " + amountInWords(num % 100000) : "")
  );
};

const DisplayBuyerInfo = ({ name, phone, address, city, state, customerType, shopName }) => {
  let customerDisplayName = name;
  let shopDisplayName = null;

  if (name && name.includes('(') && name.includes(')')) {
    const customerMatch = name.match(/^([^(]+?)\s*\(/);
    const shopMatch = name.match(/\(([^)]+)\)/);
    customerDisplayName = customerMatch ? customerMatch[1].trim() : name;
    shopDisplayName = shopMatch ? shopMatch[1].trim() : null;
  } else if (customerType === 'shop' && shopName) {
    customerDisplayName = name;
    shopDisplayName = shopName;
  }

  return (
    <div style={{ ...S.text, margin: 0, padding: 0 }}>
      {customerDisplayName && customerDisplayName !== "—" && (
        <div style={{ margin: "2px 0", fontSize: "0.78rem", fontWeight: "600", lineHeight: "1.4" }}>
          {customerDisplayName}
        </div>
      )}
      {shopDisplayName && (
        <div style={{ margin: "2px 0", fontSize: "0.78rem", lineHeight: "1.4" }}>
          {shopDisplayName}
        </div>
      )}
      {phone && phone !== "—" && (
        <div style={{ margin: "2px 0", fontSize: "0.78rem", lineHeight: "1.4" }}>
          {phone}
        </div>
      )}
      {address && address !== "—" && (
        <div style={{ margin: "2px 0", fontSize: "0.78rem", lineHeight: "1.4" }}>
          {address}
        </div>
      )}
      {(city && city !== "—" || state && state !== "—") && (
        <div style={{ margin: "2px 0", fontSize: "0.78rem", lineHeight: "1.4" }}>
          {[city, state].filter(Boolean).join(" - ")}
        </div>
      )}
    </div>
  );
};

const InvoicePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [logoBase64, setLogoBase64] = useState(null);
  const [logoReady, setLogoReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const convertLogoToBase64 = async () => {
      try {
        const response = await fetch(radnusLogo);
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          if (!cancelled) {
            setLogoBase64(reader.result);
            setLogoReady(true);
          }
        };
        reader.onerror = () => {
          console.warn("Logo base64 conversion failed, falling back to file path");
          if (!cancelled) setLogoReady(true);
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        console.warn("Logo fetch failed, falling back to file path:", err);
        if (!cancelled) setLogoReady(true);
      }
    };
    convertLogoToBase64();
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    invoiceNumber,
    items = [],
    total = 0,
    paymentMode = "",
    date = new Date().toISOString(),
    buyerName = "—",
    buyerPhone = "",
    buyerAddress = "—",
    buyerCity = "",
    buyerState = "",
    courierCharge = 80,
    discount = 0,
    salesperson = "",
    referenceNo = "",
    customerType = "",
    shopName = "",
    orderType = "",
    priceType = "retailerPrice",
  } = location.state || {};

  const componentRef = useRef();
  const [saveMessage, setSaveMessage] = useState("");

  // Calculate totals from items - use actual item prices
  const subtotalFromItems = items.reduce((sum, item) => sum + (item.price || 0) * item.qty, 0);
  const discountedSubtotal = subtotalFromItems - discount;
  const grandTotal = discountedSubtotal + courierCharge;
  const totalQty = items.reduce((s, i) => s + i.qty, 0);

  const buyerLine3 = [buyerCity, buyerState].filter(Boolean).join(" - ");
  const grandTotalWords = `INR ${amountInWords(Math.round(grandTotal))} Only`;

  const formatReferenceNo = () => {
    if (!referenceNo) return "";
    const d = new Date(date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    return `${referenceNo} dt. ${d}`;
  };

  const forceInlineColours = (root) => {
    if (!root) return;
    const BLACK = "#000000";
    const WHITE = "#ffffff";

    root.style.all = "initial";
    root.style.display = "block";
    root.style.background = WHITE;
    root.style.color = BLACK;
    root.style.fontFamily = "Arial, sans-serif";
    root.style.WebkitTextFillColor = BLACK;

    root.querySelectorAll("*").forEach((el) => {
      el.style.setProperty("color", BLACK, "important");
      el.style.setProperty("-webkit-text-fill-color", BLACK, "important");
      if (
        !el.classList.contains("invoice-outer") &&
        !el.classList.contains("invoice-container")
      ) {
        el.style.setProperty("background-color", "transparent", "important");
      }
    });

    root.style.setProperty("background-color", WHITE, "important");
    root.style.setProperty("color", BLACK, "important");

    root.querySelectorAll(".items-table th").forEach((th) => {
      th.style.setProperty("background-color", "#f0f0f0", "important");
      th.style.setProperty("color", BLACK, "important");
      th.style.setProperty("-webkit-text-fill-color", BLACK, "important");
      th.style.setProperty("-webkit-print-color-adjust", "exact", "important");
      th.style.setProperty("print-color-adjust", "exact", "important");
    });

    root.querySelectorAll(".items-table td").forEach((td) => {
      td.style.setProperty("background-color", WHITE, "important");
      td.style.setProperty("color", BLACK, "important");
      td.style.setProperty("-webkit-text-fill-color", BLACK, "important");
    });
    root.querySelectorAll(".meta-table td").forEach((td) => {
      td.style.setProperty("background-color", WHITE, "important");
      td.style.setProperty("color", BLACK, "important");
      td.style.setProperty("-webkit-text-fill-color", BLACK, "important");
    });
  };

  const restoreInlineColours = (root) => {
    if (!root) return;
    root.querySelectorAll("*").forEach((el) => {
      el.style.removeProperty("color");
      el.style.removeProperty("-webkit-text-fill-color");
      el.style.removeProperty("background-color");
    });
    root.style.removeProperty("background-color");
    root.style.removeProperty("color");
    root.style.all = "";
  };

  const handlePrint = () => {
    const invoiceHTML = componentRef.current.innerHTML;
    const printWindow = window.open("", "_blank", "width=900,height=700");
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8"/>
        <base href="${window.location.origin}/">
        <title>Invoice - ${invoiceNumber}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; background: #fff; color: #000; padding: 0; margin: 0; }
          @page { margin: 10mm; size: A4 portrait; }

          .invoice-outer {
            background: #fff;
            color: #000;
            padding: 1rem;
            border: 1px solid #000 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          p { margin: 2px 0; }

          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin: 0.5rem 0;
            font-size: 0.75rem;
          }
          .items-table th {
            border: 1px solid #000;
            padding: 0.45rem 0.4rem;
            background: #f0f0f0 !important;
            color: #000000 !important;
            -webkit-text-fill-color: #000000 !important;
            font-weight: 800;
            text-transform: uppercase;
            font-size: 0.72rem;
            letter-spacing: 0.6px;
            text-align: left;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .items-table td {
            border: 1px solid #000;
            padding: 0.35rem 0.4rem;
            background: #ffffff;
            color: #000000;
            -webkit-text-fill-color: #000000;
            vertical-align: middle;
          }
          .items-table tbody tr:nth-child(even) td {
            background: #f5f5f5 !important;
          }
          .meta-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.75rem;
          }
          .meta-table td {
            border: 1px solid #000;
            padding: 0.25rem 0.35rem;
            background: #ffffff;
            color: #000000;
            -webkit-text-fill-color: #000000;
          }

          * {
            color: #000000 !important;
            -webkit-text-fill-color: #000000 !important;
            background-color: transparent !important;
          }
          body {
            background-color: #ffffff !important;
          }
          .invoice-outer {
            background-color: #ffffff !important;
            border: 1px solid #000 !important;
          }
          .items-table th {
            background: #f0f0f0 !important;
            color: #000000 !important;
            -webkit-text-fill-color: #000000 !important;
          }
          .items-table td {
            background: #ffffff !important;
          }
          .items-table tbody tr:nth-child(even) td {
            background: #f5f5f5 !important;
          }

          .items-table tr {
            page-break-inside: avoid;
          }
          .items-table thead {
            display: table-header-group;
          }

          .invoice-logo-img {
            height: 55px;
            width: auto;
            max-width: 130px;
            object-fit: contain;
            display: block;
          }
        </style>
      </head>
      <body>
        ${invoiceHTML}
        <script>
          window.onload = function() {
            document.querySelectorAll('th').forEach(function(th) {
              th.style.cssText = 'background:#f0f0f0!important;color:#000000!important;-webkit-text-fill-color:#000000!important;border:1px solid #000;padding:0.45rem 0.4rem;font-weight:800;text-transform:uppercase;font-size:0.72rem;letter-spacing:0.6px;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact;';
            });
            document.querySelectorAll('td').forEach(function(td) {
              td.style.color = '#000000';
              td.style.webkitTextFillColor = '#000000';
            });
            window.print();
            window.onafterprint = function() { window.close(); };
            setTimeout(function() { window.close(); }, 3000);
          };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleSavePDF = () => {
    const root = componentRef.current;
    forceInlineColours(root);

    const options = {
      margin: 8,
      filename: `Invoice-${invoiceNumber}.pdf`,
      image: { type: "jpeg", quality: 1.0 },
      html2canvas: {
        scale: 3,
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: "#ffffff",
        onclone: (clonedDoc) => {
          const cloneRoot = clonedDoc.querySelector(".invoice-container");
          if (cloneRoot) {
            cloneRoot.style.all = "initial";
            cloneRoot.style.display = "block";
            cloneRoot.style.background = "#ffffff";
            cloneRoot.style.color = "#000000";
            cloneRoot.style.fontFamily = "Arial, sans-serif";
            forceInlineColours(cloneRoot);
          }
        },
      },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    };

    html2pdf()
      .set(options)
      .from(root)
      .save()
      .then(() => {
        restoreInlineColours(root);
        setSaveMessage("✓ PDF saved");
        setTimeout(() => setSaveMessage(""), 2500);
      })
      .catch(() => restoreInlineColours(root));
  };

  if (!invoiceNumber) {
    return (
      <div style={{ padding: "2rem", color: "var(--text-primary)" }}>
        No invoice data found.
      </div>
    );
  }

  const tdStyle = (rowIdx, isTotal = false) =>
    isTotal ? S.tdTotal : rowIdx % 2 === 0 ? S.tdWhite : S.tdGrey;

  const logoSrc = logoBase64 || radnusLogo;

  return (
    <div className={`invoice-page ${isDark ? "dark" : ""}`}>
      <div className="invoice-actions">
        <button onClick={() => navigate(-1)} className="back-btn">
          ← Back
        </button>
        <div className="action-btn-group">
          <button onClick={handlePrint} className="print-btn" disabled={!logoReady}>
            <Printer size={16} /> {logoReady ? "Print" : "Preparing..."}
          </button>
          <button onClick={handleSavePDF} className="save-btn" disabled={!logoReady}>
            <FileText size={16} /> {logoReady ? "Save PDF" : "Preparing..."}
          </button>
        </div>
      </div>

      {saveMessage && (
        <div className="save-message" style={S.text}>
          {saveMessage}
        </div>
      )}

      <div ref={componentRef} className="invoice-container" style={S.wrap}>
        <div className="invoice-outer" style={S.wrap}>
          {/* HEADER WITH LOGO */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              borderBottom: "1px solid #000",
              paddingBottom: "0.5rem",
              marginBottom: "0",
              ...S.wrap,
            }}
          >
            <div style={{
              width: "110px",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              flexShrink: 0
            }}>
              <img
                src={logoSrc}
                alt="RADNUS"
                className="invoice-logo-img"
                style={{
                  height: "55px",
                  width: "auto",
                  display: "block",
                  maxWidth: "100px",
                  objectFit: "contain",
                }}
                onError={(e) => {
                  console.warn('Logo load error, showing text fallback');
                  e.target.style.display = "none";
                  const parent = e.target.parentNode;
                  const fallback = document.createElement("span");
                  fallback.textContent = "RADNUS";
                  fallback.style.cssText = "font-weight:700;font-size:18px;color:#000;";
                  parent.appendChild(fallback);
                }}
              />
            </div>

            <div style={{
              textAlign: "center",
              flex: 1,
              padding: "0 0.5rem"
            }}>
              <div style={{
                ...S.text,
                fontSize: "1.1rem",
                fontWeight: "700",
                letterSpacing: "0.5px"
              }}>
                RADNUS COMMUNICATION
              </div>
              <div style={{ ...S.text, fontSize: "0.7rem", marginTop: "2px" }}>
                No.242/244, MG Road, Sinnaya Plaza, Near KFC Chicken
              </div>
              <div style={{ ...S.text, fontSize: "0.7rem" }}>
                Puducherry - 605001 &nbsp;|&nbsp; State Name: Puducherry, Code: 605001
              </div>
              <div style={{ ...S.text, fontSize: "0.7rem" }}>
                E-Mail: sundar12134@gmail.com
              </div>
            </div>

            <div style={{ width: "110px", flexShrink: 0 }}></div>
          </div>

          {/* INVOICE title bar */}
          <div
            style={{
              textAlign: "center",
              fontSize: "1rem",
              fontWeight: "700",
              padding: "0.4rem",
              borderBottom: "1px solid #000",
              marginBottom: "0.5rem",
              ...S.text,
            }}
          >
            INVOICE
          </div>

          {/* Two-column: Consignee + Meta */}
          <div style={{ display: "flex", borderBottom: "1px solid #000" }}>
            <div
              style={{
                width: "50%",
                padding: "0.4rem 0.5rem",
                borderRight: "1px solid #000",
              }}
            >
              <div
                style={{
                  ...S.text,
                  fontWeight: "700",
                  fontSize: "0.95rem",
                  marginBottom: "4px",
                }}
              >
                Consignee (Ship to)
              </div>

              <DisplayBuyerInfo
                name={buyerName}
                phone={buyerPhone}
                address={buyerAddress}
                city={buyerCity}
                state={buyerState}
                customerType={customerType}
                shopName={shopName}
              />

              <div
                style={{
                  ...S.text,
                  fontWeight: "700",
                  fontSize: "0.95rem",
                  margin: "10px 0 4px",
                }}
              >
                Buyer (Bill to)
              </div>
              <DisplayBuyerInfo
                name={buyerName}
                phone={buyerPhone}
                address={buyerAddress}
                city={buyerCity}
                state={buyerState}
                customerType={customerType}
                shopName={shopName}
              />
            </div>

            <div style={{ width: "50%", padding: "0.4rem 0.5rem" }}>
              <table
                className="meta-table"
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.7rem",
                }}
              >
                <tbody>
                  {[
                    ["Invoice No.", invoiceNumber],
                    ["Dated", new Date(date).toDateString()],
                    ["Delivery Note", ""],
                    ["Mode/Terms of Payment", paymentMode?.toUpperCase() || ""],
                    ["Salesperson", salesperson || ""],
                    ["Reference No. & Date", formatReferenceNo()],
                    ["Order Type", orderType || ""],
                    ["Buyer's Order No.", ""],
                    ["Dispatched through", ""],
                    ["Destination", buyerLine3],
                    ["Terms of Delivery", ""],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td
                        style={{
                          ...S.metaTd,
                          fontWeight: "600",
                          whiteSpace: "nowrap",
                          width: "40%",
                        }}
                      >
                        {label}
                       </td>
                      <td style={S.metaTd}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Items Table */}
          <table
            className="items-table"
            style={{
              width: "100%",
              borderCollapse: "collapse",
              margin: "0.5rem 0",
            }}
          >
            <thead>
              <tr>
                {["SL NO.", "DESCRIPTION", "HSN", "QTY", "RATE", "PER", "AMOUNT"].map(
                  (h) => (
                    <th key={h} style={S.th}>
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx}>
                  <td style={tdStyle(idx)}>{idx + 1}</td>
                  <td style={tdStyle(idx)}>{item.name}</td>
                  <td style={tdStyle(idx)}>-</td>
                  <td style={{ ...tdStyle(idx), textAlign: "center" }}>{item.qty} NOS</td>
                  <td style={{ ...tdStyle(idx), textAlign: "right" }}>₹{item.price}</td>
                  <td style={tdStyle(idx)}>NOS</td>
                  <td style={{ ...tdStyle(idx), textAlign: "right" }}>
                    ₹{(item.qty * item.price).toFixed(2)}
                  </td>
                </tr>
              ))}
              {discount > 0 && (
                <tr>
                  <td style={tdStyle(items.length)}></td>
                  <td style={tdStyle(items.length)}>DISCOUNT</td>
                  <td style={tdStyle(items.length)}></td>
                  <td style={tdStyle(items.length)}></td>
                  <td style={tdStyle(items.length)}></td>
                  <td style={tdStyle(items.length)}></td>
                  <td style={{ ...tdStyle(items.length), textAlign: "right" }}>-₹{discount}.00</td>
                </tr>
              )}
              <tr>
                <td style={tdStyle(items.length + (discount > 0 ? 1 : 0))}></td>
                <td style={tdStyle(items.length + (discount > 0 ? 1 : 0))}>
                  COURIER CHARGE
                </td>
                <td style={tdStyle(items.length + (discount > 0 ? 1 : 0))}></td>
                <td style={tdStyle(items.length + (discount > 0 ? 1 : 0))}></td>
                <td style={tdStyle(items.length + (discount > 0 ? 1 : 0))}></td>
                <td style={tdStyle(items.length + (discount > 0 ? 1 : 0))}></td>
                <td style={{ ...tdStyle(items.length + (discount > 0 ? 1 : 0)), textAlign: "right" }}>
                  ₹{courierCharge}.00
                </td>
              </tr>
              {/* Total row */}
              <tr>
                <td style={S.tdTotal}></td>
                <td style={{ ...S.tdTotal, fontWeight: "700" }}>TOTAL</td>
                <td style={S.tdTotal}></td>
                <td style={{ ...S.tdTotal, fontWeight: "700", textAlign: "center" }}>
                  {totalQty} NOS
                </td>
                <td style={S.tdTotal}></td>
                <td style={S.tdTotal}></td>
                <td style={{ ...S.tdTotal, fontWeight: "700", textAlign: "right" }}>
                  ₹{grandTotal.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Amount in words */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "0.4rem 0.5rem",
              borderBottom: "1px solid #000",
              ...S.text,
            }}
          >
            <div>
              <strong style={S.text}>Amount Chargeable (in words)</strong>
              <br />
              <span style={{ ...S.text, fontSize: "0.8rem" }}>{grandTotalWords}</span>
            </div>
          </div>

          {/* Declaration */}
          <div
            style={{
              padding: "0.4rem 0.5rem",
              borderBottom: "1px solid #000",
              ...S.text,
            }}
          >
            <strong style={S.text}>Declaration</strong>
            <br />
            <span style={{ ...S.text, fontSize: "0.7rem" }}>
              We declare that this invoice shows the actual price of the goods
              described and that all particulars are true and correct.
            </span>
          </div>

          {/* Signature */}
          <div
            style={{
              display: "flex",
              padding: "0.4rem 0.5rem",
              borderBottom: "1px solid #000",
            }}
          >
            <div style={{ width: "60%", ...S.text }}>
              <div style={{ fontSize: "0.8rem", ...S.text }}>E. &amp; O.E</div>
            </div>
            <div style={{ width: "40%", textAlign: "right", ...S.text }}>
              <strong style={S.text}>for RADNUS COMMUNICATION</strong>
              <div
                style={{
                  marginTop: "1.5rem",
                  borderTop: "1px solid #000",
                  width: "100%",
                }}
              ></div>
              <span style={{ ...S.text, fontSize: "0.7rem" }}>Authorised Signatory</span>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              textAlign: "center",
              padding: "0.3rem",
              fontSize: "0.6rem",
              ...S.text,
            }}
          >
            This is a Computer Generated Invoice
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoicePage;

//++++++++++++++++ ORDER Place change before ++++++++++++++++
// const mongoose = require("mongoose");
// const Invoice = require("../models/Invoice/InvoiceModel");
// const StockMovement = require("../models/Purchase/StockMovement");
// const Product = require("../models/AdminModel/Product");
// const {
//   getBatchQueue,
//   computeAllocation,
//   consumeAllocations,
//   InsufficientStockError,
// } = require("../services/fifoAllocationService");

// const getFinancialYear = () => {
//   const now = new Date();
//   const year = now.getFullYear();
//   const month = now.getMonth() + 1;
//   return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
// };


// // Core save routine — shared by the transactional path and the
// // non-transactional fallback (standalone MongoDB without a replica set).
// // Mirrors the pattern already used in purchaseController.runPurchaseSave.
// async function runInvoiceSave(body, session) {
//   const {
//     items,
//     totalAmount,
//     paymentMode,
//     billerName,
//     status,
//     customerPhone,
//     customerName,
//     customerType,
//     shopName,
//     customerAddress,
//     customerCity,
//     customerState,
//     sameAsBuyer,
//     shippingAddress,
//     subtotal,
//     discount,
//     courierCharge,
//     salesperson,
//     referenceNo,
//     invoiceDate,
//     orderType,
//   } = body;

//   if (!customerPhone || !customerName || !items || !items.length || !totalAmount || !paymentMode) {
//     throw new Error("Missing required invoice fields");
//   }

//   // ─── FIFO allocation: figure out which batches each line item consumes,
//   // then actually decrement those batches, before the invoice is written.
//   // Any shortfall throws InsufficientStockError, which aborts the whole
//   // transaction — nothing is partially saved.
//   const itemsWithAllocations = [];
//   const movementDocs = [];
//   const productQtyTotals = new Map(); // productId (string) -> total qty sold, for the Product.moq update below

//   for (const item of items) {
//     if (!item.productId) throw new Error("Each invoice item must reference a product");
//     const qty = Number(item.qty);
//     if (!qty || qty <= 0) throw new Error(`Invalid quantity for ${item.name || item.productId}`);

//     const productObjectId = mongoose.Types.ObjectId.isValid(item.productId)
//       ? new mongoose.Types.ObjectId(item.productId)
//       : item.productId;

//     const allocations = await computeAllocation(productObjectId, qty, { session });
//     await consumeAllocations(allocations, session);

//     itemsWithAllocations.push({
//       ...item,
//       batchAllocations: allocations.map((a) => ({
//         batchId: a.batchId,
//         batchNo: a.batchNo,
//         qty: a.qty,
//         purchaseCost: a.purchaseCost,
//       })),
//     });

//     for (const a of allocations) {
//       movementDocs.push({
//         productId: productObjectId,
//         batchNo: a.batchNo,
//         type: "sale",
//         quantity: -a.qty, // negative = stock out
//         referenceType: "Invoice",
//       });
//     }

//     const key = String(productObjectId);
//     productQtyTotals.set(key, (productQtyTotals.get(key) || 0) + qty);
//   }

//   // Keep Product.moq (the denormalized "current total stock" field used across
//   // the UI — Products list, Order Cart, etc.) in sync with the batch-level
//   // truth, atomically alongside the batch decrements above. This mirrors how
//   // purchaseController.runPurchaseSave increments moq on the inbound side.
//   for (const [productId, totalQty] of productQtyTotals.entries()) {
//     await Product.findByIdAndUpdate(
//       productId,
//       { $inc: { moq: -totalQty } },
//       { session, new: true }
//     );
//   }

//   const financialYear = getFinancialYear();
//   const lastInvoice = await Invoice.findOne({ financialYear }).sort({ sequence: -1 }).session(session);
//   const nextSequence = lastInvoice ? lastInvoice.sequence + 1 : 1;
//   const paddedSequence = String(nextSequence).padStart(3, "0");
//   const invoiceNumber = `RC${financialYear}/${paddedSequence}`;

//   const created = await Invoice.create(
//     [
//       {
//         invoiceNumber,
//         financialYear,
//         sequence: nextSequence,
//         billerName,
//         items: itemsWithAllocations,
//         totalAmount,
//         paymentMode,
//         status: status || "completed",
//         customerPhone,
//         customerName,
//         customerType: customerType || "customer",
//         shopName: shopName || "",
//         customerAddress: customerAddress || "",
//         customerCity: customerCity || "",
//         customerState: customerState || "",
//         sameAsBuyer: sameAsBuyer !== undefined ? sameAsBuyer : true,
//         shippingAddress: sameAsBuyer ? {} : (shippingAddress || {}),
//         subtotal: subtotal || totalAmount - (courierCharge || 0),
//         discount: discount || 0,
//         courierCharge: courierCharge || 0,
//         salesperson: salesperson || "",
//         referenceNo: referenceNo || "",
//         invoiceDate: invoiceDate || new Date(),
//         orderType: orderType || "",
//       },
//     ],
//     { session }
//   );
//   const invoice = created[0];

//   const movementDocsWithRef = movementDocs.map((m) => ({ ...m, referenceId: invoice._id }));
//   await StockMovement.insertMany(movementDocsWithRef, { session });

//   return invoice;
// }

// // ─── Create Invoice (transactional, with fallback) ──────────────────────────
// // Response shape is unchanged from before — existing frontend callers keep
// // working exactly as they did. The only new behavior is that stock is now
// // actually consumed batch-by-batch (FIFO) instead of not being touched at all.
// const createInvoice = async (req, res) => {
//   const session = await mongoose.startSession();

//   try {
//     let invoice;
//     try {
//       await session.withTransaction(async () => {
//         invoice = await runInvoiceSave(req.body, session);
//       });
//     } catch (txErr) {
//       const msg = txErr?.message || "";
//       const transactionsUnsupported =
//         /Transaction numbers|IllegalOperation|replica set|not supported|Mongos/i.test(msg);

//       if (transactionsUnsupported) {
//         console.warn(
//           "MongoDB transactions unsupported on this deployment — falling back to sequential (non-transactional) save:",
//           msg
//         );
//         invoice = await runInvoiceSave(req.body, null);
//       } else {
//         throw txErr;
//       }
//     }

//     res.status(201).json({
//       success: true,
//       invoice: {
//         id: invoice._id,
//         invoiceNumber: invoice.invoiceNumber,
//         date: invoice.invoiceDate,
//         totalAmount: invoice.totalAmount,
//       },
//     });
//   } catch (err) {
//     console.error("createInvoice error:", err);
//     if (err instanceof InsufficientStockError || err.name === "InsufficientStockError") {
//       return res.status(409).json({
//         message: err.message,
//         code: "INSUFFICIENT_STOCK",
//         productId: err.productId,
//       });
//     }
//     res.status(500).json({ message: err.message });
//   } finally {
//     session.endSession();
//   }
// };

// // ─── FIFO Batch Queue (read-only, for the Billing UI cards) ─────────────────
// // GET /api/invoices/batch-queue/:productId
// const getProductBatchQueue = async (req, res) => {
//   try {
//     const { productId } = req.params;
//     if (!mongoose.Types.ObjectId.isValid(productId)) {
//       return res.status(400).json({ message: "Invalid product ID" });
//     }
//     const queue = await getBatchQueue(new mongoose.Types.ObjectId(productId));
//     res.json({ queue });
//   } catch (err) {
//     console.error("getProductBatchQueue error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };

// // ─── Preview Allocation (read-only, no writes) ──────────────────────────────
// // POST /api/invoices/preview-allocation  { productId, qty }
// // Powers the "Batch Allocation Panel" — shown live as the cashier types a
// // quantity, before the invoice is actually created.
// const previewAllocation = async (req, res) => {
//   try {
//     const { productId, qty } = req.body;
//     if (!mongoose.Types.ObjectId.isValid(productId)) {
//       return res.status(400).json({ message: "Invalid product ID" });
//     }
//     const allocations = await computeAllocation(new mongoose.Types.ObjectId(productId), qty);
//     res.json({ allocations });
//   } catch (err) {
//     if (err instanceof InsufficientStockError) {
//       return res.status(409).json({
//         message: err.message,
//         code: "INSUFFICIENT_STOCK",
//         available: err.available,
//       });
//     }
//     console.error("previewAllocation error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };

// // ✅ GET INVOICES (WITH STATUS FILTER) - FIXED
// const getInvoices = async (req, res) => {
//   try {
//     const { filter, billerName, status } = req.query;
//     let query = {};
//     const now = new Date();

//     const getDayRange = (date) => {
//       const start = new Date(date);
//       start.setHours(0, 0, 0, 0);
//       const end = new Date(date);
//       end.setHours(23, 59, 59, 999);
//       return { start, end };
//     };

//     // ✅ Apply date filter
//     if (filter === "today") {
//       const { start, end } = getDayRange(now);
//       query.createdAt = { $gte: start, $lte: end };
//     } else if (filter === "week") {
//       const start = new Date(now);
//       start.setDate(now.getDate() - 7);
//       start.setHours(0, 0, 0, 0);
//       query.createdAt = { $gte: start, $lte: now };
//     } else if (filter === "month") {
//       const start = new Date(now);
//       start.setMonth(now.getMonth() - 1);
//       start.setHours(0, 0, 0, 0);
//       query.createdAt = { $gte: start, $lte: now };
//     }
//     // If filter === "all", no date filter

//     // ✅ Apply biller name filter
//     if (billerName && billerName.trim() !== "") {
//       query.billerName = billerName;
//     }

//     // ✅ CRITICAL FIX: Apply status filter
//     if (status && status.trim() !== "") {
//       query.status = status; // ← Now properly filters
//     }

//     const invoices = await Invoice.find(query).sort({ createdAt: -1 });

//     res.json(invoices);
//   } catch (err) {
//     console.error("getInvoices error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };

// // ✅ UPDATE STATUS
// const updateInvoiceStatus = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body;

//     // ✅ Validate status
//     if (!['draft', 'completed'].includes(status)) {
//       return res.status(400).json({ 
//         message: 'Invalid status. Must be "draft" or "completed"' 
//       });
//     }

//     const invoice = await Invoice.findOneAndUpdate(
//       { invoiceNumber: id },
//       { status },
//       { new: true }
//     );

//     if (!invoice) {
//       return res.status(404).json({ message: 'Invoice not found' });
//     }

//     res.json({
//       success: true,
//       invoice,
//     });
//   } catch (err) {
//     console.error("updateInvoiceStatus error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };


// const deleteInvoice = async (req, res) => {
//   try {
//     const { invoiceNumber } = req.params;

//     const deleted = await Invoice.findOneAndDelete({ invoiceNumber });

//     if (!deleted) {
//       return res.status(404).json({ msg: "Invoice not found" });
//     }

//     res.json({ msg: "Invoice deleted successfully" });
//   } catch (err) {
//     res.status(500).json({ msg: err.message });
//   }
// };

// module.exports = { 
//   createInvoice, 
//   getInvoices, 
//   updateInvoiceStatus,
//   deleteInvoice, // ← Don't forget to add to routes!
//   getProductBatchQueue, // NEW — FIFO batch queue for the Billing UI
//   previewAllocation,    // NEW — live allocation preview before invoice creation
// };

//===== Below code for ordertype updated and Before FIFO =============

// const Invoice = require("../models/Invoice/InvoiceModel");

// const getFinancialYear = () => {
//   const now = new Date();
//   const year = now.getFullYear();
//   const month = now.getMonth() + 1;
//   return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
// };


// const createInvoice = async (req, res) => {
//   try {
//     const {
//       items,
//       totalAmount,
//       paymentMode,
//       billerName,
//       status,
//       customerPhone,
//       customerName,
//       customerType,
//       shopName,
//       customerAddress,
//       customerCity,
//       customerState,
//       sameAsBuyer,
//       shippingAddress,
//       subtotal,
//       discount,           // 🆕
//       courierCharge,
//       salesperson,
//       referenceNo,
//       invoiceDate,
//       orderType,
//     } = req.body;

//     if (!customerPhone || !customerName || !items || !items.length || !totalAmount || !paymentMode) {
//       return res.status(400).json({ message: "Missing required invoice fields" });
//     }

//     const financialYear = getFinancialYear();
//     const lastInvoice = await Invoice.findOne({ financialYear }).sort({ sequence: -1 });
//     const nextSequence = lastInvoice ? lastInvoice.sequence + 1 : 1;
//     const paddedSequence = String(nextSequence).padStart(3, "0");
//     const invoiceNumber = `RC${financialYear}/${paddedSequence}`;

//     const invoice = await Invoice.create({
//       invoiceNumber,
//       financialYear,
//       sequence: nextSequence,
//       billerName,
//       items,
//       totalAmount,
//       paymentMode,
//       status: status || "completed",
//       customerPhone,
//       customerName,
//       customerType: customerType || "customer",
//       shopName: shopName || "",
//       customerAddress: customerAddress || "",
//       customerCity: customerCity || "",
//       customerState: customerState || "",
//       sameAsBuyer: sameAsBuyer !== undefined ? sameAsBuyer : true,
//       shippingAddress: sameAsBuyer ? {} : (shippingAddress || {}),
//       subtotal: subtotal || totalAmount - (courierCharge || 0),
//       discount: discount || 0,                   // ✅ include discount
//       courierCharge: courierCharge || 0,
//       salesperson: salesperson || "",
//       referenceNo: referenceNo || "",
//       invoiceDate: invoiceDate || new Date(),
//       orderType: orderType || '', 
//     });

//     res.status(201).json({
//       success: true,
//       invoice: {
//         id: invoice._id,
//         invoiceNumber: invoice.invoiceNumber,
//         date: invoice.invoiceDate,
//         totalAmount: invoice.totalAmount,
//       },
//     });
//   } catch (err) {
//     console.error("createInvoice error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };

// // ✅ GET INVOICES (WITH STATUS FILTER) - FIXED
// const getInvoices = async (req, res) => {
//   try {
//     const { filter, billerName, status } = req.query;
//     let query = {};
//     const now = new Date();

//     const getDayRange = (date) => {
//       const start = new Date(date);
//       start.setHours(0, 0, 0, 0);
//       const end = new Date(date);
//       end.setHours(23, 59, 59, 999);
//       return { start, end };
//     };

//     // ✅ Apply date filter
//     if (filter === "today") {
//       const { start, end } = getDayRange(now);
//       query.createdAt = { $gte: start, $lte: end };
//     } else if (filter === "week") {
//       const start = new Date(now);
//       start.setDate(now.getDate() - 7);
//       start.setHours(0, 0, 0, 0);
//       query.createdAt = { $gte: start, $lte: now };
//     } else if (filter === "month") {
//       const start = new Date(now);
//       start.setMonth(now.getMonth() - 1);
//       start.setHours(0, 0, 0, 0);
//       query.createdAt = { $gte: start, $lte: now };
//     }
//     // If filter === "all", no date filter

//     // ✅ Apply biller name filter
//     if (billerName && billerName.trim() !== "") {
//       query.billerName = billerName;
//     }

//     // ✅ CRITICAL FIX: Apply status filter
//     if (status && status.trim() !== "") {
//       query.status = status; // ← Now properly filters
//     }

//     const invoices = await Invoice.find(query).sort({ createdAt: -1 });

//     res.json(invoices);
//   } catch (err) {
//     console.error("getInvoices error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };

// // ✅ UPDATE STATUS
// const updateInvoiceStatus = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body;

//     // ✅ Validate status
//     if (!['draft', 'completed'].includes(status)) {
//       return res.status(400).json({ 
//         message: 'Invalid status. Must be "draft" or "completed"' 
//       });
//     }

//     const invoice = await Invoice.findOneAndUpdate(
//       { invoiceNumber: id },
//       { status },
//       { new: true }
//     );

//     if (!invoice) {
//       return res.status(404).json({ message: 'Invoice not found' });
//     }

//     res.json({
//       success: true,
//       invoice,
//     });
//   } catch (err) {
//     console.error("updateInvoiceStatus error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };


// const deleteInvoice = async (req, res) => {
//   try {
//     const { invoiceNumber } = req.params;

//     const deleted = await Invoice.findOneAndDelete({ invoiceNumber });

//     if (!deleted) {
//       return res.status(404).json({ msg: "Invoice not found" });
//     }

//     res.json({ msg: "Invoice deleted successfully" });
//   } catch (err) {
//     res.status(500).json({ msg: err.message });
//   }
// };

// module.exports = { 
//   createInvoice, 
//   getInvoices, 
//   updateInvoiceStatus,
//   deleteInvoice, // ← Don't forget to add to routes!
// };