import {
  Boxes,
  ClipboardCheck,
  Flower2,
  HandCoins,
  LayoutDashboard,
  PackagePlus,
  ReceiptText,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Wallet,
  ShieldCheck,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  path: string;
  nameKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  gradient: string;
  moduleId: string;
  adminOnly?: boolean;
}

/** Danh sách các module chính của hệ thống phân phối hoa Hoa Khang Thành. */
export const NAV_ITEMS: NavItem[] = [
  {
    path: '/',
    nameKey: 'Dashboard',
    descriptionKey: 'Tổng quan kinh doanh hoa tươi',
    icon: LayoutDashboard,
    gradient: 'bg-gradient-to-br from-indigo-500 to-indigo-700',
    moduleId: 'dashboard',
  },
  {
    path: '/don-hang',
    nameKey: 'Đơn hàng',
    descriptionKey: 'Quản lý đơn đặt hoa sỉ & giao hàng',
    icon: ShoppingCart,
    gradient: 'bg-gradient-to-br from-blue-500 to-blue-700',
    moduleId: 'donHang',
  },
  {
    path: '/nha-phan-phoi',
    nameKey: 'Danh sách NPP',
    descriptionKey: 'Đại lý phân phối & chuỗi shop hoa',
    icon: Store,
    gradient: 'bg-gradient-to-br from-purple-500 to-purple-700',
    moduleId: 'npp',
  },
  {
    path: '/cong-no',
    nameKey: 'Công nợ NPP',
    descriptionKey: 'Sổ theo dõi công nợ NPP & khách hàng theo ngày',
    icon: ReceiptText,
    gradient: 'bg-gradient-to-br from-amber-600 to-orange-700',
    moduleId: 'congNoNPP',
  },
  {
    path: '/hoa',
    nameKey: 'Danh sách hoa',
    descriptionKey: 'Danh mục các loại hoa tươi & giá sỉ',
    icon: Flower2,
    gradient: 'bg-gradient-to-br from-rose-500 to-pink-700',
    moduleId: 'hoa',
  },
  {
    path: '/ton-ngay',
    nameKey: 'Tồn ngày',
    descriptionKey: 'Kiểm tồn & đối soát đơn hàng mỗi ngày',
    icon: ClipboardCheck,
    gradient: 'bg-gradient-to-br from-cyan-500 to-blue-600',
    moduleId: 'tonNgay',
  },
  {
    path: '/nha-cung-cap',
    nameKey: 'Danh sách NCC',
    descriptionKey: 'Nhà vườn & đối tác cung ứng hoa',
    icon: Truck,
    gradient: 'bg-gradient-to-br from-emerald-500 to-emerald-700',
    moduleId: 'ncc',
  },
  {
    path: '/cong-no-ncc',
    nameKey: 'Công nợ NCC',
    descriptionKey: 'Sổ theo dõi công nợ nhà cung cấp & nhà vườn',
    icon: HandCoins,
    gradient: 'bg-gradient-to-br from-emerald-600 to-teal-700',
    moduleId: 'congNoNCC',
  },
  {
    path: '/thu-chi',
    nameKey: 'Thu chi',
    descriptionKey: 'Sổ quỹ thu chi & dòng tiền hoa tươi',
    icon: Wallet,
    gradient: 'bg-gradient-to-br from-teal-500 to-teal-700',
    moduleId: 'thuChi',
  },
  {
    path: '/ton-kho',
    nameKey: 'Tồn kho',
    descriptionKey: 'Kiểm soát kho lạnh & xuất nhập tồn',
    icon: Boxes,
    gradient: 'bg-gradient-to-br from-amber-500 to-amber-700',
    moduleId: 'tonKho',
  },
  {
    path: '/don-hang-ncc',
    nameKey: 'Đơn hàng NCC',
    descriptionKey: 'Đơn đặt hoa nhà vườn & đọc ảnh đơn OCR',
    icon: PackagePlus,
    gradient: 'bg-gradient-to-br from-emerald-600 to-teal-700',
    moduleId: 'donHangNCC',
  },
  {
    path: '/nhan-vien',
    nameKey: 'Danh sách nhân viên',
    descriptionKey: 'Đội ngũ nhân sự & nghệ nhân cắm hoa',
    icon: Users,
    gradient: 'bg-gradient-to-br from-sky-500 to-sky-700',
    moduleId: 'nhanVien',
  },
  {
    path: '/phan-quyen',
    nameKey: 'Phân quyền',
    descriptionKey: 'Thiết lập quyền xem, thêm, sửa, xoá theo nhân sự',
    icon: ShieldCheck,
    gradient: 'bg-gradient-to-br from-blue-600 to-indigo-800',
    moduleId: 'phanQuyen',
    adminOnly: true,
  },
  {
    path: '/cai-dat',
    nameKey: 'Cài đặt',
    descriptionKey: 'Kết nối Google Sheets (ID sheet) & cấu hình hệ thống',
    icon: Settings,
    gradient: 'bg-gradient-to-br from-slate-500 to-slate-700',
    moduleId: 'caiDat',
    adminOnly: true,
  },
];
