import {z} from "zod";

export const SignInSchema = z.object({
  email:z.email()
})

export const CreateNewOrder = z.object({
  asset:z.string(),
  type:z.enum(['long','short']),
  margin:z.number(),
  leverage:z.number(),
  slippage:z.number()
})

export const ClosePosition = z.object({
  orderId:z.string()
})
