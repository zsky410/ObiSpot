# Demo Path Chinh (Day 1 chot script)

## Muc tieu demo
Chung minh duoc luong dat san end-to-end, co cap nhat trang thai thoi gian that va chatbot goi y theo du lieu that.

## Kich ban demo
1. Customer login bang tai khoan demo.
2. Customer mo danh sach venue/field, chon ngay gan nhat.
3. Customer chon mot slot `available` va tao booking.
4. UI customer hien booking moi o trang thai `pending`.
5. Admin login web admin, mo booking list loc `pending`.
6. Admin xac nhan booking -> trang thai thanh `confirmed`.
7. Customer refresh `My bookings` va thay booking da `confirmed`.
8. Customer hoi chatbot: "Toi mai con san 7 nguoi khong?"
9. Chatbot tra loi slot dua tren DB; neu loi AI thi hien fallback.

## Tieu chi pass
- Khong co loi 5xx trong luong chinh.
- Booking tao thanh cong, khong trung slot active.
- Trang thai booking dong bo customer/admin duoi 3 giay trong demo.
- Chatbot khong bịa slot, chi tra loi theo du lieu truy xuat.
