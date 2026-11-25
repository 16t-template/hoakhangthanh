import { useRef, useState } from 'react';
import { Copy, ExternalLink, FileText, Printer, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Order } from '@/types/hoaKhangThanh';
import { formatDate } from '@/lib/format';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
}

export function generateInvoiceUrl(order: Order): string {
  const ngay = formatDate(order.orderDate);
  const khachHang = encodeURIComponent(order.distributorName || 'Khách hàng');
  const cuoc = order.shippingFee || 0;
  const truHang = order.discount || 0;
  const congNo = order.oldDebt || 0;
  const phone = encodeURIComponent(order.phone || '');
  const code = encodeURIComponent(order.code || '');
  const products = (order.items || [])
    .filter((item) => item.flowerName)
    .map(
      (item) =>
        `${encodeURIComponent(item.flowerName)}_a_${item.unitPrice || 0}_a_${item.quantity || 0}`
    )
    .join('_b_');

  return `${import.meta.env.BASE_URL}hoa_khang_thanh.html?id=${code}?phone=${phone}?ngay=${encodeURIComponent(ngay)}?khach_hang=${khachHang}?cuoc=${cuoc}?tru_hang=${truHang}?cong_no=${congNo}?${products}`;
}

export function HoaDonPrintModal({ isOpen, onClose, order }: Props) {
  const [previewMode, setPreviewMode] = useState<'simple' | 'full'>('simple');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({});
  const invoiceRef = useRef<HTMLDivElement>(null);

  if (!isOpen || !order) return null;

  const itemsSubtotal =
    order.itemsSubtotal ||
    order.items?.reduce((s, i) => s + (i.amount || (i.unitPrice || 0) * (i.quantity || 0)), 0) ||
    0;
  const shippingFee = order.shippingFee || 0;
  const discount = order.discount || 0;
  const totalAmount = order.totalAmount || itemsSubtotal + shippingFee - discount;
  const oldDebt = order.oldDebt || 0;
  const totalPayment = order.totalPayment || totalAmount + oldDebt;

  const formatNumber = (num: number) => {
    return (num || 0).toLocaleString('vi-VN');
  };

  const invoiceUrl = generateInvoiceUrl(order);

  const handleCopyLink = () => {
    const fullUrl = `${window.location.origin}${invoiceUrl}`;
    navigator.clipboard
      .writeText(fullUrl)
      .then(() => {
        toast.success('Đã sao chép đường dẫn hóa đơn!');
      })
      .catch(() => {
        toast.error('Không thể sao chép liên kết');
      });
  };

  const handleOpenNewTab = () => {
    window.open(invoiceUrl, '_blank');
  };

  const handlePrint = (mode: 'full' | 'simple') => {
    // Tạo iframe ẩn để in riêng biệt nội dung hóa đơn
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);

    const doc = printFrame.contentWindow?.document;
    if (!doc) return;

    if (mode === 'simple') {
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html lang="vi">
        <head>
          <meta charset="UTF-8">
          <title>Hóa Đơn Bán Hàng - Khang Thành Flower</title>
          <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
          <style>
            @page { size: A4; margin: 12mm 15mm; }
            * { box-sizing: border-box; }
            body {
              font-family: 'Montserrat', sans-serif;
              background-color: #ffffff;
              color: #0f172a;
              margin: 0;
              padding: 0;
              -webkit-font-smoothing: antialiased;
            }
            .simple-container { width: 100%; max-width: 100%; margin: 0 auto; }
            .info-section {
              border-left: 3px solid #b38b00;
              padding: 2px 0 2px 12px;
              margin-bottom: 16px;
            }
            .info-line {
              font-size: 15px;
              line-height: 1.6;
              color: #334155;
            }
            .info-label { color: #475569; }
            .info-val-date { font-weight: 700; color: #0f172a; }
            .info-val-customer { font-weight: 700; color: #0f172a; text-transform: uppercase; }
            table { width: 100%; border-collapse: collapse; font-size: 14px; }
            thead tr {
              border-top: 1.5px solid #1e3a8a;
              border-bottom: 1.5px solid #1e3a8a;
            }
            th {
              color: #1e3a8a;
              font-weight: 700;
              text-transform: uppercase;
              padding: 10px 4px;
              font-size: 14px;
              letter-spacing: 0.5px;
            }
            .col-tick { width: 48px; text-align: center; }
            .col-stt { width: 52px; text-align: center; }
            .col-flower { text-align: center; }
            .col-sl { width: 70px; text-align: center; }
            .col-note { width: 110px; text-align: center; }

            tbody tr { border-bottom: 0.5px solid #e2e8f0; }
            td {
              padding: 9px 4px;
              vertical-align: middle;
              font-size: 14px;
            }
            td.col-tick { text-align: center; }
            .check-box {
              width: 16px;
              height: 16px;
              border: 1.5px solid #94a3b8;
              border-radius: 3px;
              display: inline-block;
              vertical-align: middle;
              background: #ffffff;
              line-height: 14px;
              font-size: 11px;
              text-align: center;
              font-weight: bold;
              color: #1e3a8a;
            }
            td.col-stt {
              text-align: center;
              color: #475569;
              font-weight: 500;
            }
            td.col-flower {
              text-align: left;
              font-weight: 700;
              text-transform: uppercase;
              color: #0f172a;
              padding-left: 14px;
              line-height: 1.35;
            }
            td.col-sl {
              text-align: right;
              padding-right: 20px;
              color: #334155;
              font-weight: 500;
              font-size: 14px;
            }
            td.col-note {
              text-align: left;
              color: #64748b;
              padding-left: 14px;
              font-size: 13px;
            }
          </style>
        </head>
        <body>
          <div class="simple-container">
            <div class="info-section">
              <div class="info-line">
                <span class="info-label">Ngày:</span> <span class="info-val-date">${formatDate(order.orderDate)}</span>
              </div>
              <div class="info-line">
                <span class="info-label">Khách hàng:</span> <span class="info-val-customer">${order.distributorName || 'Khách vãng lai'}</span>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th class="col-tick">V</th>
                  <th class="col-stt">STT</th>
                  <th class="col-flower">TÊN HOA</th>
                  <th class="col-sl">SL</th>
                  <th class="col-note">GHI CHÚ</th>
                </tr>
              </thead>
              <tbody>
                ${(order.items || [])
                  .filter((item) => item.flowerName)
                  .map(
                    (p, idx) => `
                  <tr>
                    <td class="col-tick">
                      <span class="check-box">${checkedItems[idx] ? '✓' : ''}</span>
                    </td>
                    <td class="col-stt">${idx + 1}</td>
                    <td class="col-flower">${p.flowerName}</td>
                    <td class="col-sl">${p.quantity || 0}</td>
                    <td class="col-note">${notes[idx] || '...'}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </body>
        </html>
      `);
      doc.close();
    } else {
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html lang="vi">
        <head>
          <meta charset="UTF-8">
          <title>Hóa Đơn - ${order.code}</title>
          <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,700&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
          <style>
            @page { size: A4; margin: 10mm; }
            * { box-sizing: border-box; }
            body {
              font-family: 'Montserrat', sans-serif;
              background-color: white;
              color: #2c3e50;
              margin: 0;
              padding: 10px;
              -webkit-font-smoothing: antialiased;
            }
            .invoice-container { max-width: 100%; margin: 0 auto; }
            .header-top { display: flex; justify-content: space-between; align-items: center; width: 100%; }
            .logo-img { width: 7rem; height: auto; }
            .qr-img { width: 7.5rem; height: auto; }
            .shop-info { text-align: center; }
            .shop-name { font-family: 'Playfair Display', serif; font-style: italic; font-size: 2rem; font-weight: 700; color: #b38b00; margin: 0; }
            .address { font-size: 0.85rem; margin: 0.25rem 0 0; }
            .phone { font-size: 0.85rem; font-weight: 600; color: #b38b00; margin: 0; }
            .title-section { text-align: center; margin: 0.75rem 0 0.5rem; }
            .header-title { font-family: 'Playfair Display', serif; color: #1e3a8a; font-size: 22px; letter-spacing: 1.5px; border-bottom: 1px solid #1e3a8a; display: inline-block; padding-bottom: 4px; text-transform: uppercase; margin: 0; }
            .info-section { margin-bottom: 0.75rem; font-size: 0.9rem; border-left: 2px solid #b38b00; padding: 0.4rem 0 0.4rem 0.8rem; background-color: #fffaf0; }
            .info-section p { margin: 0; line-height: 1.4; }
            .text-gray-600 { color: #4b5563; }
            .font-bold { font-weight: 700; }
            table { border-collapse: collapse; width: 100%; font-size: 13px; }
            th, td { border-bottom: 0.5px solid #e2e8f0; padding: 6px 4px; line-height: 1.3; }
            th { border-top: 1px solid #1e3a8a; border-bottom: 1px solid #1e3a8a; color: #1e3a8a; font-weight: 600; text-transform: uppercase; text-align: center; }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .col-stt { width: 35px; text-align: center; }
            .col-flower { text-align: left; font-weight: 700; color: #111827; }
            .col-sl { width: 50px; text-align: center; font-weight: bold; }
            .col-gia { width: 90px; text-align: right; }
            .col-tien { width: 110px; text-align: right; font-weight: bold; }
            .summary-container { display: flex; justify-content: flex-end; margin-top: 1rem; }
            .glass-panel { width: 320px; border: 1px solid rgba(179, 139, 0, 0.2); border-radius: 8px; padding: 1rem; background: rgba(179, 139, 0, 0.03); }
            .summary-row { display: flex; justify-content: space-between; border-bottom: 1px solid rgba(179, 139, 0, 0.1); padding-bottom: 0.35rem; margin-bottom: 0.35rem; font-size: 0.85rem; }
            .summary-total { display: flex; justify-content: space-between; font-weight: 700; color: #1e3a8a; margin-top: 0.5rem; font-size: 0.95rem; }
            .summary-final { display: flex; justify-content: space-between; font-size: 1.05rem; font-weight: 700; color: #1e3a8a; margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid rgba(30, 58, 138, 0.2); text-transform: uppercase; }
            .footer-msg { text-align: center; margin-top: 2rem; font-style: italic; color: #6b7280; font-family: 'Playfair Display', serif; font-size: 0.85rem; }
          </style>
        </head>
        <body>
          <div class="invoice-container">
            <div class="header-top">
              <div class="logo-box">
                <img src="https://i.ibb.co/X1vVPZn/65-A0-B8-B5-1-EA7-43-D4-87-EC-DB2-C237-B4-EC6.png" alt="Logo" class="logo-img">
              </div>
              <div class="qr-box">
                <img src="https://img.vietqr.io/image/MB-0090123457979-qr_only.png" alt="QR" class="qr-img">
              </div>
            </div>
            <div class="shop-info">
              <h1 class="shop-name">Khang Thành Flower</h1>
              <p class="address">338 Xô Viết Nghệ Tĩnh - P. Lang Biang - Đà Lạt</p>
              <p class="phone">SĐT: 0902.422.102</p>
              <p class="phone">STK: 0090123457979 - MB - NGUYEN THI THUY LOAN</p>
            </div>
            <div class="title-section">
              <h2 class="header-title">Hóa Đơn Bán Hàng</h2>
              <div style="font-family: monospace; font-size: 12px; color: #6b7280; margin-top: 4px;">ID: ${order.code}</div>
            </div>
            <div class="info-section">
              <p><span class="text-gray-600">Ngày đặt:</span> <span class="font-bold">${formatDate(order.orderDate)}</span></p>
              <p><span class="text-gray-600">Khách hàng:</span> <span class="font-bold">${order.distributorName}</span>${order.phone ? ` • ${order.phone}` : ''}</p>
              ${order.address ? `<p class="text-gray-600" style="font-size: 12px;"><span>Địa chỉ:</span> ${order.address}</p>` : ''}
            </div>
            <table>
              <thead>
                <tr>
                  <th class="col-stt">STT</th>
                  <th class="col-flower" style="text-align: left; padding-left: 8px;">Tên hoa</th>
                  <th class="col-sl">SL</th>
                  <th class="col-gia">Đơn giá</th>
                  <th class="col-tien">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                ${(order.items || []).filter(item => item.flowerName).map((p, idx) => `
                  <tr>
                    <td class="col-stt">${idx + 1}</td>
                    <td class="col-flower" style="padding-left: 8px;">${p.flowerName}</td>
                    <td class="col-sl">${p.quantity || 0}</td>
                    <td class="col-gia">${formatNumber(p.unitPrice || 0)}</td>
                    <td class="col-tien">${formatNumber((p.unitPrice || 0) * (p.quantity || 0))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <div class="summary-container">
              <div class="glass-panel">
                <div class="summary-row">
                  <span class="text-gray-600">Tiền hàng:</span>
                  <span style="font-weight: 600; font-family: monospace;">${formatNumber(itemsSubtotal)}</span>
                </div>
                <div class="summary-row">
                  <span class="text-gray-600">Phí vận chuyển:</span>
                  <span style="font-weight: 600; font-family: monospace;">${formatNumber(shippingFee)}</span>
                </div>
                <div class="summary-row">
                  <span class="text-gray-600">Tiền trừ hàng:</span>
                  <span style="font-weight: 600; font-family: monospace; color: #e11d48;">-${formatNumber(discount)}</span>
                </div>
                <div class="summary-total">
                  <span>TỔNG CỘNG:</span>
                  <span style="font-family: monospace;">${formatNumber(totalAmount)}</span>
                </div>
                <div class="summary-row" style="margin-top: 8px;">
                  <span class="text-gray-600">Nợ cũ:</span>
                  <span style="font-weight: 600; font-family: monospace; color: ${oldDebt < 0 ? '#047857' : '#b45309'};">${oldDebt < 0 ? `Dư: ${formatNumber(Math.abs(oldDebt))}` : formatNumber(oldDebt)}</span>
                </div>
                <div class="summary-final">
                  <span>Thanh toán:</span>
                  <span style="font-family: monospace; font-weight: 800;">${totalPayment < 0 ? `Dư: ${formatNumber(Math.abs(totalPayment))}` : formatNumber(totalPayment)}</span>
                </div>
              </div>
            </div>
            <div class="footer-msg">
              <p>Khang Thành Flower chân thành cảm ơn quý khách!</p>
            </div>
          </div>
        </body>
        </html>
      `);
      doc.close();
    }

    setTimeout(() => {
      printFrame.contentWindow?.focus();
      printFrame.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(printFrame);
      }, 1000);
    }, 400);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[95vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* TOP BAR / ACTIONS */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white shrink-0 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Printer size={18} className="text-amber-400" />
              <span className="font-bold text-sm tracking-wide hidden sm:inline">
                Phiếu In — <span className="font-mono text-amber-400">{order.code}</span>
              </span>
            </div>

            {/* TAB CHUYỂN CHẾ ĐỘ XEM TRƯỚC */}
            <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700">
              <button
                type="button"
                onClick={() => setPreviewMode('simple')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  previewMode === 'simple'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Xem mẫu in tối giản (V, STT, Tên hoa, SL, Ghi chú) như Ảnh 2"
              >
                Mẫu Tối giản (Ảnh 2)
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('full')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  previewMode === 'full'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Xem mẫu in A4 đầy đủ gồm logo, đơn giá, thành tiền và công nợ"
              >
                Mẫu A4 Đầy đủ
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handlePrint('simple')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-sm transition-colors cursor-pointer"
              title="In ngay mẫu tối giản (V, STT, Tên hoa, SL, Ghi chú) như Ảnh 2"
            >
              <FileText size={13} />
              <span>In Tối giản</span>
            </button>

            <button
              type="button"
              onClick={() => handlePrint('full')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-950 bg-amber-500 hover:bg-amber-400 shadow-sm transition-colors cursor-pointer"
              title="In toàn bộ phiếu A4 gồm đầy đủ giá tiền và công nợ"
            >
              <Printer size={13} />
              <span>In A4 Đầy đủ</span>
            </button>

            <button
              type="button"
              onClick={handleOpenNewTab}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md transition-colors cursor-pointer"
              title="Mở toàn bộ phiếu in trong tab riêng của trình duyệt"
            >
              <ExternalLink size={14} className="text-white" />
              <span>Mở Tab Mới</span>
            </button>

            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer"
              title="Sao chép liên kết phiếu in"
            >
              <Copy size={13} />
              <span className="hidden sm:inline">Sao chép Link</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ml-1 cursor-pointer"
              title="Đóng (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* INVOICE PREVIEW CONTAINER */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-[#fffcf5]">
          {previewMode === 'simple' ? (
            /* ============================================================== */
            /* MẪU IN TỐI GIẢN CHUẨN THEO ẢNH 2                               */
            /* ============================================================== */
            <div
              ref={invoiceRef}
              className="invoice-container max-w-[800px] mx-auto bg-white rounded-xl p-6 sm:p-10 border border-gray-200 shadow-sm text-slate-900"
              style={{ fontFamily: "'Montserrat', sans-serif" }}
            >
              {/* Header: Viền vàng bên trái, Ngày & Khách hàng */}
              <div className="border-l-[3px] border-[#b38b00] pl-3 py-0.5 mb-5 space-y-1">
                <div className="text-[15px] leading-relaxed text-slate-700">
                  <span className="text-slate-600">Ngày:</span>{' '}
                  <span className="font-bold text-slate-900">{formatDate(order.orderDate)}</span>
                </div>
                <div className="text-[15px] leading-relaxed text-slate-700">
                  <span className="text-slate-600">Khách hàng:</span>{' '}
                  <span className="font-bold uppercase text-slate-900">
                    {order.distributorName || 'Khách vãng lai'}
                  </span>
                </div>
              </div>

              {/* Bảng 5 cột: V | STT | TÊN HOA | SL | GHI CHÚ */}
              <div className="table-container overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-t-[1.5px] border-b-[1.5px] border-[#1e3a8a] text-[#1e3a8a] uppercase text-sm font-bold">
                      <th className="py-2.5 px-2 text-center w-12">V</th>
                      <th className="py-2.5 px-2 text-center w-14">STT</th>
                      <th className="py-2.5 px-3 text-center">TÊN HOA</th>
                      <th className="py-2.5 px-2 text-center w-16">SL</th>
                      <th className="py-2.5 px-3 text-center w-28">GHI CHÚ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(order.items || [])
                      .filter((item) => item.flowerName)
                      .map((p, idx) => {
                        const qty = p.quantity || 0;
                        return (
                          <tr key={idx} className="border-b border-slate-200 hover:bg-slate-50/50">
                            <td className="py-2.5 px-2 text-center">
                              <input
                                type="checkbox"
                                checked={!!checkedItems[idx]}
                                onChange={(e) =>
                                  setCheckedItems((prev) => ({ ...prev, [idx]: e.target.checked }))
                                }
                                className="w-4 h-4 rounded border border-slate-400 text-blue-600 cursor-pointer align-middle"
                              />
                            </td>
                            <td className="py-2.5 px-2 text-center text-slate-600 font-medium">
                              {idx + 1}
                            </td>
                            <td className="py-2.5 px-3 text-left font-bold uppercase text-slate-900 leading-snug">
                              {p.flowerName}
                            </td>
                            <td className="py-2.5 px-2 text-right pr-5 font-medium text-slate-700 text-sm">
                              {qty}
                            </td>
                            <td className="py-2.5 px-3 text-left">
                              <input
                                type="text"
                                value={notes[idx] ?? ''}
                                onChange={(e) =>
                                  setNotes((prev) => ({ ...prev, [idx]: e.target.value }))
                                }
                                placeholder="..."
                                className="w-full bg-transparent border-0 text-slate-600 placeholder:text-slate-400 text-sm focus:outline-none"
                              />
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* ============================================================== */
            /* MẪU IN A4 ĐẦY ĐỦ                                               */
            /* ============================================================== */
            <div
              ref={invoiceRef}
              className="invoice-container max-w-[800px] mx-auto bg-white/95 rounded-2xl p-5 sm:p-8 border border-amber-900/10 shadow-lg text-[#2c3e50]"
              style={{ fontFamily: "'Montserrat', sans-serif" }}
            >
              {/* Header Section */}
              <div className="invoice-header pb-3 mb-3 border-b border-gray-200">
                <div className="header-top flex justify-between items-center w-full">
                  <div className="logo-box bg-white p-2 rounded-lg shadow-sm">
                    <img
                      src="https://i.ibb.co/X1vVPZn/65-A0-B8-B5-1-EA7-43-D4-87-EC-DB2-C237-B4-EC6.png"
                      alt="Khang Thành Flower Logo"
                      className="w-24 sm:w-28 h-auto"
                    />
                  </div>
                  <div className="qr-box bg-white p-1 rounded-lg shadow-sm">
                    <img
                      src="https://img.vietqr.io/image/MB-0090123457979-qr_only.png"
                      alt="QR Thanh Toán"
                      className="w-24 sm:w-28 h-auto"
                    />
                  </div>
                </div>

                <div className="shop-info text-center mt-2">
                  <h1
                    className="shop-name text-2xl sm:text-3xl font-bold italic text-[#b38b00] leading-tight m-0"
                    style={{ fontFamily: "'Playfair Display', serif" }}
                  >
                    Khang Thành Flower
                  </h1>
                  <p className="address text-xs sm:text-sm text-gray-700 mt-1 mb-0.5">
                    338 Xô Viết Nghệ Tĩnh - P. Lang Biang - Đà Lạt
                  </p>
                  <p className="phone text-xs sm:text-sm font-semibold text-[#b38b00] m-0">
                    SĐT: 0902.422.102
                  </p>
                  <p className="phone text-xs sm:text-sm font-semibold text-[#b38b00] m-0">
                    STK: 0090123457979 - MB - NGUYEN THI THUY LOAN
                  </p>
                </div>
              </div>

              {/* Title Section */}
              <div className="title-section text-center mb-2">
                <h2
                  className="header-title inline-block text-xl sm:text-2xl font-bold uppercase tracking-wider text-[#1e3a8a] border-b border-[#1e3a8a] pb-1 m-0"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  Hóa Đơn Bán Hàng
                </h2>
                <div className="text-xs text-gray-500 font-mono mt-1">ID: {order.code}</div>
              </div>

              {/* Info Section */}
              <div className="info-section mb-3 text-xs sm:text-sm border-l-2 border-[#b38b00] py-2 pl-3.5 bg-[#fffaf0] rounded-r-lg space-y-1">
                <p>
                  <span className="text-gray-600">Ngày đặt:</span>{' '}
                  <span className="font-bold text-gray-900">{formatDate(order.orderDate)}</span>
                </p>
                <p>
                  <span className="text-gray-600">Khách hàng:</span>{' '}
                  <span className="font-bold text-gray-900">{order.distributorName}</span>
                  {order.phone && <span className="text-gray-600 font-mono"> • {order.phone}</span>}
                </p>
                {order.address && (
                  <p className="text-gray-600 text-xs">
                    <span>Địa chỉ:</span> {order.address}
                  </p>
                )}
              </div>

              {/* Table Section */}
              <div className="table-container overflow-x-auto mb-4">
                <table className="w-full border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="border-t border-b border-[#1e3a8a] text-[#1e3a8a] uppercase bg-[#fffcf5]/60 text-xs font-bold">
                      <th className="col-stt py-2.5 px-2 text-center w-10">STT</th>
                      <th className="col-flower py-2.5 px-2 text-left">Tên hoa</th>
                      <th className="col-sl py-2.5 px-2 text-center w-14">SL</th>
                      <th className="col-gia py-2.5 px-2 text-right w-24">Đơn giá</th>
                      <th className="col-tien py-2.5 px-2 text-right w-28">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(order.items || [])
                      .filter((item) => item.flowerName)
                      .map((p, idx) => {
                        const price = p.unitPrice || 0;
                        const qty = p.quantity || 0;
                        const amount = p.amount || price * qty;

                        return (
                          <tr key={idx} className="border-b border-gray-200 hover:bg-amber-50/30">
                            <td className="col-stt py-2 px-1 text-center text-gray-500 font-mono">
                              {idx + 1}
                            </td>
                            <td className="col-flower py-2 px-2 font-bold text-gray-900">
                              {p.flowerName}
                            </td>
                            <td className="col-sl py-2 px-1 text-center font-mono font-bold">
                              {qty}
                            </td>
                            <td className="col-gia py-2 px-2 text-right font-mono text-gray-700">
                              {formatNumber(price)}
                            </td>
                            <td className="col-tien py-2 px-2 text-right font-mono font-bold text-gray-900">
                              {formatNumber(amount)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              {/* Footer Summary */}
              <div className="summary-container flex justify-end mt-4">
                <div className="glass-panel w-full sm:w-80 bg-amber-50/50 border border-amber-900/15 rounded-xl p-4 shadow-sm text-xs sm:text-sm">
                  <div className="summary-row flex justify-between py-1 border-b border-amber-900/10">
                    <span className="text-gray-600">Tiền hàng:</span>
                    <span className="font-semibold font-mono text-gray-900">
                      {formatNumber(itemsSubtotal)}
                    </span>
                  </div>

                  <div className="summary-row flex justify-between py-1 border-b border-amber-900/10">
                    <span className="text-gray-600">Phí vận chuyển:</span>
                    <span className="font-semibold font-mono text-gray-900">
                      {formatNumber(shippingFee)}
                    </span>
                  </div>

                  <div className="summary-row flex justify-between py-1 border-b border-amber-900/10">
                    <span className="text-gray-600">Tiền trừ hàng:</span>
                    <span className="font-semibold font-mono text-rose-600">
                      -{formatNumber(discount)}
                    </span>
                  </div>

                  <div className="summary-total flex justify-between py-1.5 font-bold text-[#1e3a8a] text-sm sm:text-base border-b border-amber-900/15">
                    <span>TỔNG CỘNG:</span>
                    <span className="font-mono">{formatNumber(totalAmount)}</span>
                  </div>

                  <div className="summary-row flex justify-between py-1 border-b border-amber-900/10 mt-2">
                    <span className="text-gray-600">Nợ cũ:</span>
                    <span
                      className={`font-semibold font-mono ${
                        oldDebt < 0 ? 'text-emerald-700 font-bold' : 'text-amber-700'
                      }`}
                    >
                      {oldDebt < 0
                        ? `Dư: ${formatNumber(Math.abs(oldDebt))}`
                        : formatNumber(oldDebt)}
                    </span>
                  </div>

                  <div className="summary-final flex justify-between pt-2 mt-1 border-t-2 border-[#1e3a8a] font-bold text-[#1e3a8a] text-base sm:text-lg uppercase">
                    <span>Thanh toán:</span>
                    <span className="font-mono font-extrabold">
                      {totalPayment < 0
                        ? `Dư: ${formatNumber(Math.abs(totalPayment))}`
                        : formatNumber(totalPayment)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Footer Message */}
              <div
                className="footer-msg text-center mt-8 pt-4 border-t border-gray-100 italic text-gray-500 text-xs sm:text-sm"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                <p className="m-0">Khang Thành Flower chân thành cảm ơn quý khách!</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
