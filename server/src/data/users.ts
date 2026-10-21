import { User } from '../models.ts'

const SECRET = '+passwordHash +totpSecret +recoveryCodes +recoveryKeyHash'

export const users = {
  byEmail(email: string) {
    return User.findOne({ email })
  },
  byEmailSecret(email: string) {
    return User.findOne({ email }).select(SECRET)
  },
  byId(id: string) {
    return User.findById(id)
  },
  byIdSecret(id: string) {
    return User.findById(id).select(SECRET)
  },
  byGoogle(googleId: string) {
    return User.findOne({ googleId })
  },
  create(doc: {
    name: string
    email: string
    passwordHash: string
    googleId?: string
    pendingVerification?: boolean
    recoveryKeyHash?: string | null
  }) {
    return User.create(doc)
  },
  update(id: string, update: { name?: string; accent?: string; email?: string }) {
    return User.findByIdAndUpdate(id, update, { new: true })
  },
}
