import { User } from '../models.ts'

const SECRET = '+passwordHash +totpSecret +recoveryCodes'

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
    emailVerifiedAt?: Date | null
    googleId?: string
  }) {
    return User.create(doc)
  },
  update(id: string, update: { name?: string; accent?: string; email?: string; emailVerifiedAt?: Date | null }) {
    return User.findByIdAndUpdate(id, update, { new: true })
  },
}
