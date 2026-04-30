# Seed Plan (7-14 ngay + demo accounts)

## Demo accounts
- Customer:
  - Email: `customer@obispot.demo`
  - Password: `demo1234`
  - Role: `customer`
- Admin:
  - Email: `admin@obispot.demo`
  - Password: `demo1234`
  - Role: `admin`

## Du lieu toi thieu can co
- 1 venue, 2-3 fields.
- Slot trong 7-14 ngay toi, chia theo khung gio toi uu cho demo (18:00-22:00 + mot vai slot ban ngay).
- It nhat:
  - 1 booking `pending`.
  - 1 booking `confirmed`.
  - 1 slot `blocked`.
  - Slot trong cho hom nay va ngay mai.

## Kich ban co chu dich de demo
- Slot A: available de customer dat ngay trong luc demo.
- Slot B: da confirmed de admin/customer thay lich su.
- Slot C: blocked de admin dashboard/slot control minh hoa.
- Slot D: pending de admin co item can xu ly.

## Nguyen tac seed
- Seed idempotent (co the chay lai khong nhan ban du lieu).
- Gia tri ngay gio dung timezone `Asia/Ho_Chi_Minh`.
- FAQ chatbot map voi du lieu seed hien co (tranh tra loi mo ho).
