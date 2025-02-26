import { Response, NextFunction } from 'express';
import { AuthRequest, imageRequest } from '../../models/other';
import User, { Profiles } from '../../models/users';
import { HTTPError } from '../../models/error';
import { Session } from 'express-session';
import { v4 as uuidv4 } from 'uuid';
import appError from '../../service/appError';
import handleSuccess from '../../service/handleSuccess';
import { generateSendJWT } from '../../middleware/auth';
import bcrypt from 'bcryptjs';
import {checkPwd, checkRegister} from'../../service/checkError';

// 引入上傳圖片會用到的套件
const firebaseAdmin = require('../../middleware/firebase');
const bucket = firebaseAdmin.storage().bucket();

const user = {
  // NOTE 登入
  async login(req: AuthRequest, res: Response, next: NextFunction) {
    const { email, password } = req.body;
    if (!email || !password) {
      return next(appError(400, '帳號或密碼錯誤', next));
    }
    const user = await User.findOne(
      {
        email,
        isDisabled: false, // false 啟用 true 停用
        role: "user"
      },
    ).select('+password');
    if(!user) {
      return next(appError( 401, '無此會員或已停用', next));
    }
    const auth = await bcrypt.compare(password, user.password);
    
    if(!auth){
      return next(appError(400, '密碼錯誤', next));
    }

    req.session.role = user.role
    req.session.isLogin = true;
    generateSendJWT(user, 200, res, req.sessionID);
  },
  // NOTE 註冊
  async register(req: AuthRequest, res: Response, next: NextFunction) {
    let { email, username, password } = req.body;
    // 檢查欄位
    const errorMsg = checkRegister(req)

    if(errorMsg.length > 0) {
      return next(appError(400, errorMsg, next));
    }
    // 檢查暱稱是否已使用
    const userCheck = await User.findOne({
      username: username
    })

    if(userCheck !== null) {
      return next(appError(400, "此暱稱已被使用", next));
    }

    try {
      // 加密密碼
      password = await bcrypt.hash(req.body.password,12);
      await User.create({
        email,
        password,
        username
      });

      handleSuccess(res, '註冊成功', 201)
    } catch (error) {
      // 不打資料庫，使用 mongoose 回傳的錯誤檢查  
      if(error && (error as HTTPError).code === 11000) {
        return next(appError(400, '此 Email 已使用', next));
      } else {
        return next(appError(400, error, next));
      }
    }
  },
  // NOTE 登出
  async logout(req: AuthRequest, res:Response) {
    req.session.destroy(():void => {}) as Session & {};
    
    handleSuccess(res, '已登出')
  },
  // NOTE 取得個人資料
  async profile(req: AuthRequest, res:Response) {
    const { username, picture, email } = req.user

    const data = {
      email,
      username,
      picture
    }

    handleSuccess(res, data);
  },
  // NOTE 更新個人資料
  async updateProfiles (req: AuthRequest, res: Response, next: NextFunction) {
    const { username, picture } = req.body;
    const updateData = {} as Profiles;
    if(!username) {
      // errorMsg.push("暱稱不得為空值");
      return next(appError("400", '暱稱不得為空值', next));
    }
    // if(password) {
    //   const email = req.user.email
    //   const user = await User.findOne(
    //     {
    //       email
    //     },
    //   ).select('+password');
    //   if(user) {
    //     const auth = await bcrypt.compare(password, user.password);
    //     if(!auth){
    //       return next(appError(400,'原密碼不正確',next));
    //     }
    //     if(!newPassword) {
    //       return next(appError(400,'請輸入新密碼',next));
    //     }
    //     if(password === newPassword) {
    //       return next(appError(400,'新密碼不可於原密碼相同',next));
    //     }
    //     // 密碼檢查
    //     if(checkPwdFormat(newPassword)) {
    //       errorMsg.push(checkPwdFormat(newPassword));
    //     }
  
    //     if(newPassword !== confirmPassword){
    //       errorMsg.push("密碼不一致");
    //     }
    //     newPassword = await bcrypt.hash(password,12);
    //   }
    // }
    // if(errorMsg.length > 0) {
    //   return next(appError("400", errorMsg, next));
    // }
    // 判斷是否有上傳圖片
    if(picture) {
      updateData.picture = picture
    }
    // 判斷是否有修改密碼
    // if(newPassword) {
    //   updateData.password = newPassword
    // }
    updateData.username = username
    
    await User.findByIdAndUpdate(req.user.id, {
      $set: updateData
    })
    handleSuccess(res, '修改成功')
  },

  // NOTE 上傳個人圖片
  async uploadUserImage (req: imageRequest, res:Response, next: NextFunction) {
    if(!req.files || !req.files.length) {
      return next(appError(400, "尚未上傳檔案", next));
    }
    // 取得上傳的檔案資訊列表裡面的第一個檔案
    const file = req.files[0];
    // 基於檔案的原始名稱建立一個 blob 物件
    const blob = bucket.file(`images/user/${uuidv4()}.${file.originalname.split('.').pop()}`);
    // 建立一個可以寫入 blob 的物件
    const blobStream = blob.createWriteStream()
  
    // 監聽上傳狀態，當上傳完成時，會觸發 finish 事件
    blobStream.on('finish', () => {
      // 設定檔案的存取權限
      const config = {
        action: 'read', // 權限
        expires: '12-31-2500', // 網址的有效期限
      };
      // 取得檔案的網址
      blob.getSignedUrl(config, (err: Error, fileUrl: string) => {
        handleSuccess(res, fileUrl)
      });
    });
  
    // 如果上傳過程中發生錯誤，會觸發 error 事件
    blobStream.on('error', (err: Error) => {
      return next(appError("500", '上傳失敗', next));
    });
  
    // 將檔案的 buffer 寫入 blobStream
    blobStream.end(file.buffer);
  },
  // 更新密碼
  async updatePassword (req: AuthRequest, res:Response, next: NextFunction) {
    let { password, newPassword, confirmPassword } = req.body;
    const email = req.user.email
    const user = await User.findOne(
      {
        email
      },
    ).select('+password');
    if(user) {
      const auth = await bcrypt.compare(password, user.password);
      if(!auth){
        return next(appError(400, '原密碼不正確', next));
      }
      if(!newPassword) {
        return next(appError(400, '請輸入新密碼', next));
      }
      if(password === newPassword) {
        return next(appError(400, '新密碼不可與原密碼相同', next));
      }
      const errorMsg = []
      // 密碼檢查
      const pwdError = checkPwd(newPassword, confirmPassword)
      if(pwdError) {
        errorMsg.push(pwdError)
      }
  
      if(errorMsg.length > 0) {
        return next(appError(400, errorMsg, next));
      }
      newPassword = await bcrypt.hash(newPassword, 12);
      
      await User.findByIdAndUpdate(req.user.id,
        {
          password: newPassword
        }
      );

      handleSuccess(res, '密碼已修改');
    }
  },
}

export default user;